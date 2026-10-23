from __future__ import annotations

from fastapi.testclient import TestClient

from chamgap.api import create_app
from chamgap.config import Config

from .helpers import AutoAckLink, data_line, info_line


def test_link_endpoint_in_mock_mode(cfg: Config) -> None:
    cfg.mode = "mock"
    with TestClient(create_app(cfg)) as client:
        r = client.get("/api/link")
        assert r.status_code == 200
        body = r.json()
        assert body["mode"] == "mock" and body["mock"] is True
        assert {p["node"] for p in body["ports"]} == {"Z1", "Z2", "Z3"}


def test_docs_page(cfg: Config) -> None:
    with TestClient(create_app(cfg)) as client:
        assert client.get("/docs").status_code == 200


def _client_with_z1(cfg: Config, link: AutoAckLink, **info: object) -> TestClient:
    app = create_app(cfg, link=link)
    client = TestClient(app)
    client.__enter__()
    link.on_line("COM5", info_line("Z1", **info))
    link.on_line("COM5", data_line("Z1", seq=1))
    # 메시지가 루프에서 처리될 때까지
    for _ in range(50):
        if "Z1" in app.state.hub.nodes and app.state.hub.nodes["Z1"].info:
            break
        client.get("/api/link")
    return client


def test_command_ack_roundtrip(cfg: Config) -> None:
    link = AutoAckLink()
    client = _client_with_z1(cfg, link)
    r = client.post("/api/nodes/Z1/command", json={"cmd": "tare"})
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["ack"]["cmd"] == "tare"
    # 보정 명령 뒤에는 info를 다시 받아 둔다
    assert link.sent[-2:] == [("Z1", "COM5", "tare"), ("Z1", "COM5", "info")]
    client.__exit__(None, None, None)


def test_command_not_allowed(cfg: Config) -> None:
    client = _client_with_z1(cfg, AutoAckLink())
    r = client.post("/api/nodes/Z1/command", json={"cmd": "pump 2000"})
    assert r.status_code == 400 and r.json()["ok"] is False and r.json()["error"] == "not_allowed"
    client.__exit__(None, None, None)


def test_unknown_node_404(cfg: Config) -> None:
    client = _client_with_z1(cfg, AutoAckLink())
    r = client.post("/api/nodes/Z9/command", json={"cmd": "info"})
    assert r.status_code == 404 and r.json()["error"] == "unknown_node"
    client.__exit__(None, None, None)


def test_water_blocked_before_flow_cal(cfg: Config) -> None:
    link = AutoAckLink()
    client = _client_with_z1(cfg, link, pump_mlps=0.0)
    r = client.post("/api/nodes/Z1/water", json={"ml": 10})
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "flow_uncal" and body["message"] == "유량 보정이 먼저 필요해요"
    assert not any(t.startswith("water") for _, _, t in link.sent)  # ESP32로 안 보냄
    pf = client.get("/api/nodes/Z1/water/preflight", params={"ml": 10}).json()
    assert pf["ok"] is False and [c["key"] for c in pf["checks"] if not c["ok"]] == ["flow_uncal"]
    client.__exit__(None, None, None)


def test_water_sent_when_checks_pass(cfg: Config) -> None:
    link = AutoAckLink()
    client = _client_with_z1(cfg, link)
    r = client.post("/api/nodes/Z1/water", json={"ml": 10})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert link.sent[-1][2] == "water 10"
    client.__exit__(None, None, None)


def test_water_refused_by_esp32(cfg: Config) -> None:
    link = AutoAckLink()
    link.replies["water"] = (0, "cooldown")
    client = _client_with_z1(cfg, link)
    r = client.post("/api/nodes/Z1/water", json={"ml": 10})
    assert r.status_code == 409 and r.json()["error"] == "refused"
    client.__exit__(None, None, None)


def test_water_bad_ml_400(cfg: Config) -> None:
    client = _client_with_z1(cfg, AutoAckLink())
    r = client.post("/api/nodes/Z1/water", json={"ml": 80})
    assert r.status_code == 400 and r.json()["error"] == "bad_ml"
    client.__exit__(None, None, None)


def test_stop_and_stop_all(cfg: Config) -> None:
    link = AutoAckLink()
    client = _client_with_z1(cfg, link)
    assert client.post("/api/nodes/Z1/stop").json()["ok"] is True
    body = client.post("/api/stop-all").json()
    assert body["ok"] is True and body["results"]["Z1"]["ok"] is True
    client.__exit__(None, None, None)


def test_raw_disabled(cfg: Config) -> None:
    cfg.server.allow_raw = False
    client = _client_with_z1(cfg, AutoAckLink())
    r = client.post("/api/raw", json={"src": "COM5", "text": "air a"})
    assert r.status_code == 403 and r.json()["error"] == "raw_disabled"
    client.__exit__(None, None, None)


def test_raw_sends_as_is(cfg: Config) -> None:
    link = AutoAckLink()
    client = _client_with_z1(cfg, link)
    r = client.post("/api/raw", json={"text": "air a"})  # 포트 하나면 생략 가능
    assert r.status_code == 200 and link.sent[-1] == (None, "COM5", "air a")
    client.__exit__(None, None, None)


def test_validation_error_is_korean_400(cfg: Config) -> None:
    client = _client_with_z1(cfg, AutoAckLink())
    r = client.post("/api/nodes/Z1/water", json={"amount": 10})
    assert r.status_code == 400 and r.json()["ok"] is False and "요청 형식" in r.json()["message"]
    client.__exit__(None, None, None)


def test_pin_required_for_water_but_not_stop(cfg: Config) -> None:
    cfg.server.pin = "1234"
    client = _client_with_z1(cfg, AutoAckLink())
    r = client.post("/api/nodes/Z1/water", json={"ml": 10})
    assert r.status_code == 401 and r.json()["error"] == "pin_required"
    r = client.post("/api/nodes/Z1/water", json={"ml": 10}, headers={"X-Chamgap-Pin": "0000"})
    assert r.status_code == 401 and r.json()["error"] == "bad_pin"
    r = client.post("/api/nodes/Z1/water", json={"ml": 10}, headers={"X-Chamgap-Pin": "1234"})
    assert r.status_code == 200
    assert client.post("/api/nodes/Z1/command", json={"cmd": "tare"}).status_code == 401
    # 정지는 PIN 없이 항상
    assert client.post("/api/nodes/Z1/stop").status_code == 200
    assert client.post("/api/stop-all").json()["ok"] is True
    assert client.get("/api/link").json()["pin_required"] is True
    assert client.post("/api/pin/check", json={"pin": "1234"}).json()["ok"] is True
    assert client.post("/api/pin/check", json={"pin": "9"}).status_code == 401
    client.__exit__(None, None, None)


def test_spa_served_from_web_dist(cfg: Config, tmp_path) -> None:  # type: ignore[no-untyped-def]
    # web_dist = tmp_path/web/dist
    dist = cfg.web_dist
    with TestClient(create_app(cfg)) as client:
        r = client.get("/water/Z1")
        assert r.status_code == 200 and "빌드되지 않았어요" in r.text  # 아직 빌드 전
        dist.mkdir(parents=True, exist_ok=True)
        (dist / "assets").mkdir(exist_ok=True)
        (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
        (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
        assert "id=root" in client.get("/").text
        assert "id=root" in client.get("/zone/Z1/sensor/sht_b").text  # SPA 경로 → index.html
        js = client.get("/assets/app.js")
        assert js.status_code == 200 and "immutable" in js.headers["cache-control"]
        assert client.get("/api/nope").status_code == 404  # API는 index.html로 가지 않음
        assert client.get("/../secret").status_code in (200, 404)


def test_cors_allows_vite_dev_server(cfg: Config) -> None:
    with TestClient(create_app(cfg)) as client:
        ok = client.get("/api/link", headers={"Origin": "http://192.168.0.12:5173"})
        assert ok.headers.get("access-control-allow-origin") == "http://192.168.0.12:5173"
        bad = client.get("/api/link", headers={"Origin": "http://evil.example:5173"})
        assert "access-control-allow-origin" not in bad.headers


def test_mock_records_are_kept_apart(cfg: Config) -> None:
    cfg.mode = "mock"
    assert cfg.data_dir.name == "mock" and cfg.log_dir.name == "mock"
    cfg.mode = "serial"
    assert cfg.data_dir.name == "data" and cfg.log_dir.name == "logs"
