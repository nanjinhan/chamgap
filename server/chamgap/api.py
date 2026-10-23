"""REST 라우트와 앱 만들기 (지시서 5.1절)."""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .clock import Clock, SystemClock, parse_iso
from .commands import CommandResult
from .config import Config
from .hub import Hub
from .links import make_link
from .links.base import Link
from .netinfo import urls
from .protocol import CommandError, normalize_node, parse_web_command
from .storage import EVENT_KINDS, METRICS


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra or {}


class WaterBody(BaseModel):
    ml: float = Field(description="급수량 mL")


class CommandBody(BaseModel):
    cmd: str = Field(description="예: tare, cal 500, soilcal a air, info")


class FlowCalBody(BaseModel):
    ms: int = Field(10000, description="펌프 켤 시간 ms (50~15000)")


class PinBody(BaseModel):
    pin: str


class MarkBody(BaseModel):
    node: str | None = Field(None, description="구역 (없으면 전체 메모)")
    note: str = Field(description="예: Z1 물 20mL 줌")


class ScenarioBody(BaseModel):
    node: str = Field(description="구역 (Z1·Z2·Z3)")
    scenario: str = Field(description="normal, offline, sht_b_dead, sht_b_hot, soil_a_unplugged, ...")


class RawBody(BaseModel):
    src: str | None = Field(None, description="포트 이름. 하나뿐이면 비워도 됨")
    text: str


# 상태 코드: 사용자 입력 잘못 400, 없음 404, 지금 상태로는 안 됨 409, 장치 응답 문제 503
_PREFLIGHT_STATUS = {"bad_ml": 400, "bad_ms": 400}
_RESULT_STATUS = {"timeout": 503, "send_failed": 503, "internal": 503, "refused": 409, "cancelled": 409}


def _result_or_error(res: CommandResult) -> dict[str, Any]:
    if res.ok:
        return {"ok": True, "ack": res.ack}
    raise ApiError(_RESULT_STATUS.get(res.error or "", 409), res.error or "error", res.message_ko, {"ack": res.ack})


def build_router(hub: Hub) -> APIRouter:
    r = APIRouter(prefix="/api")

    def require_pin(x_chamgap_pin: str | None = Header(None)) -> None:
        """설정에 PIN이 있으면 급수·보정 명령에 X-Chamgap-Pin을 요구한다 (SAFE-08). 정지는 제외."""
        pin = hub.cfg.server.pin
        if pin is None:
            return
        if not x_chamgap_pin:
            raise ApiError(401, "pin_required", "PIN이 필요해요 (설정에서 입력)")
        if not secrets.compare_digest(x_chamgap_pin.encode(), pin.encode()):
            raise ApiError(401, "bad_pin", "PIN이 맞지 않아요")

    pin_dep = [Depends(require_pin)]

    def node_or_404(node: str) -> str:
        n = normalize_node(node) or ""
        if n not in hub.nodes:
            raise ApiError(404, "unknown_node", f"{n or node} 구역을 아직 본 적이 없어요")
        return n

    @r.get("/link", summary="연결 방식, 포트 상태, mock 여부")
    async def get_link() -> dict[str, Any]:
        return {**hub.link_status(), "urls": urls(hub.cfg.server.port)}

    @r.post("/pin/check", summary="PIN 확인 (설정 화면)")
    async def pin_check(body: PinBody) -> dict[str, Any]:
        require_pin(body.pin)
        return {"ok": True, "pin_required": hub.cfg.server.pin is not None}

    @r.get("/state", summary="전체 현재 상태 (지시서 5.3)")
    async def get_state() -> dict[str, Any]:
        return hub.state()

    @r.get("/nodes/{node}", summary="한 구역 상태 + 최근 메시지")
    async def get_node(node: str) -> dict[str, Any]:
        return hub.node_detail(node_or_404(node))

    # ------------------------------------------------------------ 급수·정지

    @r.get("/nodes/{node}/water/preflight", summary="급수 전 안전 검사 결과만 미리 보기")
    async def water_preflight(node: str, ml: float = Query(10.0)) -> dict[str, Any]:
        n = normalize_node(node) or node
        return hub.preflight(n, ml).to_dict()

    @r.post("/nodes/{node}/water", summary="급수 요청 (안전 검사 통과 시)", dependencies=pin_dep)
    async def water(node: str, body: WaterBody) -> dict[str, Any]:
        n = normalize_node(node) or node
        pf, res = await hub.water(n, body.ml)
        if res is None:
            f = pf.first_fail
            assert f is not None
            raise ApiError(_PREFLIGHT_STATUS.get(f.key, 409), f.key, f.detail_ko, {"checks": pf.to_dict()["checks"]})
        return _result_or_error(res)

    @r.post("/nodes/{node}/stop", summary="정지 (PIN 없이 항상)")
    async def stop(node: str) -> dict[str, Any]:
        return _result_or_error(await hub.stop_node(node_or_404(node)))

    @r.post("/stop-all", summary="모든 구역 정지 (PIN 없이 항상)")
    async def stop_all() -> dict[str, Any]:
        return await hub.stop_all()

    @r.post("/nodes/{node}/command", summary="그 밖의 명령 (허용 목록만)", dependencies=pin_dep)
    async def command(node: str, body: CommandBody) -> dict[str, Any]:
        n = node_or_404(node)
        try:
            text = parse_web_command(body.cmd)
        except CommandError as e:
            raise ApiError(400, e.code, e.message_ko) from None
        return _result_or_error(await hub.command(n, text))

    @r.post("/nodes/{node}/flow-cal/run", summary="유량 보정용 펌프 실행 + 전후 무게", dependencies=pin_dep)
    async def flow_cal_run(node: str, body: FlowCalBody) -> dict[str, Any]:
        n = normalize_node(node) or node
        pf, result = await hub.flow_cal_run(n, body.ms)
        if not pf.ok:
            f = pf.first_fail
            assert f is not None
            raise ApiError(_PREFLIGHT_STATUS.get(f.key, 409), f.key, f.detail_ko, {"checks": pf.to_dict()["checks"]})
        if not result.get("ok"):
            err = str(result.get("error") or "error")
            raise ApiError(_RESULT_STATUS.get(err, 409), err, str(result.get("message", "")))
        return result

    @r.post("/raw", summary="시험 모드 전용: 그 포트로 그대로 전송", dependencies=pin_dep)
    async def raw(body: RawBody) -> dict[str, Any]:
        if not hub.cfg.server.allow_raw:
            raise ApiError(403, "raw_disabled", "시험 모드 명령이 꺼져 있어요 (config.yaml의 allow_raw)")
        sources = hub.link.sources()
        src = body.src
        if not src:
            if len(sources) != 1:
                raise ApiError(400, "need_src", "포트를 골라 주세요" if sources else "연결된 포트가 없어요")
            src = sources[0]
        if not body.text.strip():
            raise ApiError(400, "empty", "명령이 비어 있어요")
        if not await hub.raw(src, body.text.strip()):
            raise ApiError(503, "send_failed", f"{src}로 보내지 못했어요 (연결 확인)")
        return {"ok": True, "src": src, "text": body.text.strip()}

    # ------------------------------------------------------------ 기록

    @r.get("/history", summary="그래프용 시계열 (bucket초 평균)")
    async def history(
        node: str,
        metric: str = Query("temp_a,temp_b", description=f"쉼표로: {', '.join(METRICS)}"),
        minutes: int = Query(60, ge=1, le=43200),
        bucket: int = Query(60, ge=0, le=86400, description="평균 단위(초). 60·300·900. 0이면 원본"),
    ) -> dict[str, Any]:
        n = normalize_node(node) or node
        metrics = [m.strip() for m in metric.split(",") if m.strip()]
        bad = [m for m in metrics if m not in METRICS]
        if bad or not metrics:
            raise ApiError(400, "bad_metric", f"모르는 지표예요: {', '.join(bad) or '(없음)'}")
        now = hub.clock.now()
        since = now - minutes * 60
        points = await asyncio.to_thread(hub.storage.history, n, metrics, since, now + 1, bucket)
        return {"ok": True, "node": n, "metrics": metrics, "minutes": minutes, "bucket": bucket, "points": points}

    @r.get("/events", summary="사건·ack·진단 변화 기록 (최근 것부터)")
    async def events(
        node: str | None = None,
        limit: int = Query(100, ge=1, le=5000),
        kind: str | None = Query(None, description=f"쉼표로: {', '.join(EVENT_KINDS)}"),
        minutes: int | None = Query(None, ge=1, le=43200),
    ) -> dict[str, Any]:
        n = normalize_node(node) if node else None
        kinds = [k.strip() for k in kind.split(",")] if kind else None
        since = hub.clock.now() - minutes * 60 if minutes else None
        rows = await asyncio.to_thread(hub.storage.events, n, kinds, limit, since)
        return {"ok": True, "events": rows}

    @r.post("/mark", summary="메모 남기기")
    async def mark(body: MarkBody) -> dict[str, Any]:
        note = body.note.strip()
        if not note:
            raise ApiError(400, "empty", "메모가 비어 있어요")
        n = normalize_node(body.node) if body.node else None
        return {"ok": True, "mark": hub.mark(n, note[:500])}

    @r.get("/export.csv", summary="CSV 내보내기 (구역·기간)")
    async def export_csv(
        node: str | None = None,
        from_: str | None = Query(None, alias="from", description="ISO 시각 또는 YYYY-MM-DD (기본 24시간 전)"),
        to: str | None = Query(None, description="ISO 시각 또는 YYYY-MM-DD (기본 지금)"),
    ) -> StreamingResponse:
        now = hub.clock.now()
        try:
            since = parse_iso(from_) if from_ else now - 86400
            until = parse_iso(to) + (86400 if to and len(to.strip()) == 10 else 0) if to else now + 1
        except ValueError:
            raise ApiError(400, "bad_time", "기간 형식이 잘못됐어요 (예: 2026-10-23 또는 2026-10-23T09:00)") from None
        n = normalize_node(node) if node else None
        await asyncio.to_thread(hub.storage.flush)
        stamp = datetime.fromtimestamp(min(until, now) - 1).strftime("%Y%m%d")
        name = f"chamgap_{n or 'all'}_{stamp}.csv"
        return StreamingResponse(
            hub.storage.export_csv(n, since, until),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @r.get("/diagnostics", summary="지금 활성인 진단 전부")
    async def diagnostics() -> dict[str, Any]:
        return {"ok": True, "diagnostics": hub.all_diagnostics()}

    @r.post("/diagnostics/reload", summary="diagnostics.yaml 다시 읽기")
    async def diagnostics_reload() -> dict[str, Any]:
        try:
            n = hub.reload_diagnostics()
        except ValueError as e:
            raise ApiError(400, "bad_yaml", str(e)) from None
        return {"ok": True, "rules": n}

    @r.post("/mock/scenario", summary="mock 모드 전용: 고장 재현")
    async def mock_scenario(body: ScenarioBody) -> dict[str, Any]:
        from .links.mock_link import SCENARIO_EXPECTS, SCENARIOS

        if hub.cfg.mode != "mock":
            raise ApiError(409, "not_mock", "mock 모드에서만 쓸 수 있어요")
        if body.scenario not in SCENARIOS:
            raise ApiError(400, "unknown_scenario", f"모르는 시나리오예요: {body.scenario}")
        n = normalize_node(body.node) or ""
        try:
            hub.set_mock_scenario(n, body.scenario)
        except KeyError:
            raise ApiError(404, "unknown_node", f"{n} 구역이 mock에 없어요") from None
        return {"ok": True, "node": n, "scenario": body.scenario, "expects": SCENARIO_EXPECTS[body.scenario]}

    return r


def create_app(cfg: Config, link: Link | None = None, clock: Clock | None = None) -> FastAPI:
    clock = clock or SystemClock()
    hub = Hub(cfg, link or make_link(cfg, clock), clock)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await hub.start()
        try:
            yield
        finally:
            await hub.stop()

    app = FastAPI(title="참값 브리지 서버", version=__version__, lifespan=lifespan)
    app.state.hub = hub

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"ok": False, "error": exc.code, "message": exc.message, **exc.extra}, exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", []) if x != "body")
        return JSONResponse(
            {"ok": False, "error": "bad_request", "message": f"요청 형식이 잘못됐어요 ({where})", "detail": exc.errors()},
            400,
        )

    # 개발용: Vite 개발 서버(:5173)에서 부를 수 있게 (localhost와 같은 LAN)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3}):5173$",
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(build_router(hub))

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await hub.ws.serve(ws, hub.snapshot)

    # 빌드된 웹앱(web/dist)을 함께 띄운다 (NFR-03). SPA라 모르는 경로는 index.html로.
    dist = cfg.web_dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> Response:
        if full_path.startswith(("api/", "ws")):
            raise HTTPException(404)
        index = dist / "index.html"
        if not index.exists():
            return HTMLResponse(NOT_BUILT_HTML, status_code=200)
        target = (dist / full_path).resolve()
        if full_path and target.is_file() and dist in target.parents:
            cache = "public, max-age=31536000, immutable" if full_path.startswith("assets/") else "no-cache"
            return FileResponse(target, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


NOT_BUILT_HTML = """<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>참값 서버</title>
<body style="font-family:system-ui,sans-serif;background:#EEF5FF;color:#18213A;padding:24px;line-height:1.6">
<h1 style="font-size:20px">참값 브리지 서버가 켜져 있어요</h1>
<p>웹앱이 아직 빌드되지 않았어요.</p>
<ul><li>개발 중이면: <code>web</code> 폴더에서 <code>npm run dev</code> → <b>:5173</b> 주소로 여세요</li>
<li>시연용이면: <code>web</code> 폴더에서 <code>npm run build</code> 후 이 페이지를 새로고침하세요</li>
<li>API 문서: <a href="/docs">/docs</a></li></ul></body></html>"""
