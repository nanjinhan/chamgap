"""저장 (SRV-07): 날짜별 JSONL(원본 전부) + SQLite(data → samples, 사건 → events).

쓰기는 전용 스레드 하나 + 큐로 모으고 1초마다 한 번에 커밋한다.
읽기는 부르는 쪽에서 asyncio.to_thread로 부른다 (WAL이라 쓰는 중에도 읽힌다).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import queue
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Any

from .clock import iso_local, local_date

log = logging.getLogger("chamgap.storage")

_STOP = object()
COMMIT_EVERY_S = 1.0

# samples 표의 측정값 열 (이력 API의 metric으로 쓸 수 있는 것)
METRICS = ("temp_a", "rh_a", "temp_b", "rh_b", "soil_a", "soil_b", "soil_a_mv", "soil_b_mv",
           "weight_g", "weight_sd", "v12", "leak", "pump")
EVENT_KINDS = ("evt", "ack", "info", "diag_on", "diag_off", "command", "mark", "water_result", "link")

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY,
    node TEXT NOT NULL,
    ts REAL NOT NULL,
    pc_time TEXT,
    seq INTEGER,
    temp_a REAL, rh_a REAL, temp_b REAL, rh_b REAL,
    soil_a REAL, soil_b REAL, soil_a_mv REAL, soil_b_mv REAL,
    weight_g REAL, weight_sd REAL, v12 REAL, leak INTEGER, pump INTEGER,
    raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_node_ts ON samples (node, ts);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    node TEXT,
    ts REAL NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_node_ts ON events (node, ts);
CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events (kind, ts);
"""

CSV_COLUMNS: tuple[tuple[str, str], ...] = (
    ("pc_time", "시각"), ("node", "구역"), ("seq", "순번"),
    ("temp_a", "온도A(°C)"), ("rh_a", "습도A(%)"), ("temp_b", "온도B(°C)"), ("rh_b", "습도B(%)"),
    ("soil_a", "토양A(0~1)"), ("soil_b", "토양B(0~1)"), ("soil_a_mv", "토양A(mV)"), ("soil_b_mv", "토양B(mV)"),
    ("weight_g", "무게(g)"), ("weight_sd", "흔들림(g)"), ("v12", "12V(V)"), ("leak", "누수"), ("pump", "펌프"),
)


def _num(v: Any) -> float | int | None:
    if v is None or isinstance(v, str | dict | list):
        return None
    if isinstance(v, bool):
        return int(v)
    return v  # type: ignore[no-any-return]


class Storage:
    def __init__(self, log_dir: Path, data_dir: Path, keep_days: int = 30) -> None:
        self.log_dir = log_dir
        self.data_dir = data_dir
        self.keep_days = keep_days
        self.db_path = data_dir / "chamgap.sqlite3"
        self._q: queue.Queue[Any] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._jsonl_date = ""
        self._jsonl: IO[str] | None = None
        self._db: sqlite3.Connection | None = None
        self._dirty = False
        self._last_commit = 0.0

    # ------------------------------------------------------------ 시작·끝

    def start(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self._session() as db:
            db.executescript(SCHEMA)
            if self.keep_days > 0:
                cut = time.time() - self.keep_days * 86400
                n = db.execute("DELETE FROM samples WHERE ts < ?", (cut,)).rowcount
                if n:
                    log.info("%d일 지난 측정값 %d개를 지웠어요", self.keep_days, n)
        self._thread = threading.Thread(target=self._run, name="storage-writer", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._thread is None:
            return
        self._q.put(_STOP)
        self._thread.join(timeout=5)
        self._thread = None

    def flush(self, timeout: float = 5.0) -> None:
        """지금까지 넣은 것을 다 쓰고 커밋할 때까지 기다린다."""
        if self._thread is None:
            return
        done = threading.Event()
        self._q.put(done)
        done.wait(timeout)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        return db

    @contextmanager
    def _session(self) -> Iterator[sqlite3.Connection]:
        """짧게 쓰고 닫는 연결 (읽기용)."""
        db = self._connect()
        try:
            yield db
            db.commit()
        finally:
            db.close()

    # ------------------------------------------------------------ 쓰기 (어느 스레드에서든)

    def write_jsonl(self, ts: float, record: dict[str, Any]) -> None:
        self._q.put(("jsonl", ts, record))

    def write_sample(self, node: str, ts: float, data: dict[str, Any]) -> None:
        self._q.put(("sample", node, ts, data))

    def write_event(self, node: str | None, ts: float, kind: str, payload: dict[str, Any]) -> None:
        self._q.put(("event", node, ts, kind, payload))

    # ------------------------------------------------------------ 쓰기 스레드

    def _run(self) -> None:
        self._db = self._connect()
        try:
            while True:
                try:
                    item = self._q.get(timeout=COMMIT_EVERY_S)
                except queue.Empty:
                    self._commit()
                    continue
                if item is _STOP:
                    break
                if isinstance(item, threading.Event):
                    self._commit(force=True)
                    item.set()
                    continue
                try:
                    self._handle(item)
                except Exception:
                    log.exception("저장 실패: %r", item[:2])
                self._commit()
        finally:
            self._commit(force=True)
            self._close_jsonl()
            self._db.close()
            self._db = None

    def _handle(self, item: tuple[Any, ...]) -> None:
        kind = item[0]
        if kind == "jsonl":
            _, ts, record = item
            self._jsonl_file(ts).write(json.dumps(record, ensure_ascii=False) + "\n")
            return
        assert self._db is not None
        if kind == "sample":
            _, node, ts, d = item
            self._db.execute(
                "INSERT INTO samples (node, ts, pc_time, seq, " + ", ".join(METRICS) + ", raw_json) "
                "VALUES (?, ?, ?, ?, " + ", ".join("?" for _ in METRICS) + ", ?)",
                (node, ts, d.get("pc_time"), _num(d.get("seq")), *(_num(d.get(m)) for m in METRICS),
                 json.dumps(d, ensure_ascii=False)),
            )
        elif kind == "event":
            _, node, ts, ev_kind, payload = item
            self._db.execute(
                "INSERT INTO events (node, ts, kind, payload_json) VALUES (?, ?, ?, ?)",
                (node, ts, ev_kind, json.dumps(payload, ensure_ascii=False, default=str)),
            )
        self._dirty = True

    def _commit(self, force: bool = False) -> None:
        if self._jsonl is not None:
            self._jsonl.flush()
        now = time.monotonic()
        if self._db is not None and self._dirty and (force or now - self._last_commit >= COMMIT_EVERY_S):
            self._db.commit()
            self._dirty = False
            self._last_commit = now

    def _jsonl_file(self, ts: float) -> IO[str]:
        date = local_date(ts)
        if self._jsonl is None or date != self._jsonl_date:
            self._close_jsonl()
            folder = self.log_dir / date
            folder.mkdir(parents=True, exist_ok=True)
            self._jsonl = (folder / "all.jsonl").open("a", encoding="utf-8", newline="\n")
            self._jsonl_date = date
        return self._jsonl

    def _close_jsonl(self) -> None:
        if self._jsonl is not None:
            self._jsonl.close()
            self._jsonl = None

    # ------------------------------------------------------------ 읽기 (asyncio.to_thread로)

    def history(
        self, node: str, metrics: list[str], since: float, until: float | None = None, bucket: int = 60
    ) -> list[dict[str, Any]]:
        """그래프용 시계열 (SRV-08). bucket초 단위 평균, null은 평균에서 빠진다. bucket=0이면 원본."""
        cols = [m for m in metrics if m in METRICS]
        if not cols:
            return []
        until = until if until is not None else time.time() + 60
        with self._session() as db:
            if bucket <= 0:
                rows = db.execute(
                    f"SELECT ts, {', '.join(cols)} FROM samples WHERE node = ? AND ts >= ? AND ts < ? ORDER BY ts",
                    (node, since, until),
                ).fetchall()
                pts = [(r[0], r[1:]) for r in rows]
            else:
                avg = ", ".join(f"AVG({c})" for c in cols)
                rows = db.execute(
                    f"SELECT CAST(ts / ? AS INT) AS b, {avg} FROM samples "
                    "WHERE node = ? AND ts >= ? AND ts < ? GROUP BY b ORDER BY b",
                    (bucket, node, since, until),
                ).fetchall()
                pts = [(r[0] * bucket + bucket / 2, r[1:]) for r in rows]
        out = []
        for ts, vals in pts:
            p: dict[str, Any] = {"ts": round(ts, 3), "t": iso_local(ts)}
            for c, v in zip(cols, vals, strict=True):
                p[c] = None if v is None else round(v, 4)
            out.append(p)
        return out

    def events(
        self, node: str | None = None, kinds: list[str] | None = None, limit: int = 100,
        since: float | None = None, until: float | None = None,
    ) -> list[dict[str, Any]]:
        """사건 기록, 최근 것부터."""
        where, args = [], []
        if node:
            where.append("node = ?")
            args.append(node)
        if kinds:
            where.append(f"kind IN ({', '.join('?' for _ in kinds)})")
            args.extend(kinds)
        if since is not None:
            where.append("ts >= ?")
            args.append(since)
        if until is not None:
            where.append("ts < ?")
            args.append(until)
        sql = "SELECT id, node, ts, kind, payload_json FROM events"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY ts DESC, id DESC LIMIT ?"
        args.append(max(1, min(limit, 5000)))
        with self._session() as db:
            rows = db.execute(sql, args).fetchall()
        return [
            {"id": r[0], "node": r[1], "ts": r[2], "time": iso_local(r[2]), "kind": r[3],
             "payload": json.loads(r[4]) if r[4] else {}}
            for r in rows
        ]

    def recent_samples(self, since: float) -> list[tuple[str, float, dict[str, Any]]]:
        """서버 재시작 때 이력 링버퍼 다시 채우기용 (node, ts, 원본)."""
        with self._session() as db:
            rows = db.execute("SELECT node, ts, raw_json FROM samples WHERE ts >= ? ORDER BY ts", (since,)).fetchall()
        return [(r[0], r[1], json.loads(r[2])) for r in rows if r[2]]

    def export_csv(self, node: str | None, since: float, until: float) -> Iterator[str]:
        """CSV 내보내기 (SRV-10). 엑셀에서 한글이 깨지지 않게 UTF-8 BOM을 붙인다."""
        yield "﻿"
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\r\n")
        w.writerow([label for _, label in CSV_COLUMNS])
        yield buf.getvalue()
        sql = "SELECT pc_time, node, seq, " + ", ".join(METRICS) + " FROM samples WHERE ts >= ? AND ts < ?"
        args: list[Any] = [since, until]
        if node:
            sql += " AND node = ?"
            args.append(node)
        sql += " ORDER BY ts"
        with self._session() as db:
            cur = db.execute(sql, args)
            while True:
                rows = cur.fetchmany(500)
                if not rows:
                    break
                buf = io.StringIO()
                w = csv.writer(buf, lineterminator="\r\n")
                for r in rows:
                    w.writerow(["" if v is None else v for v in r])
                yield buf.getvalue()
