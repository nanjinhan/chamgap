"""NFR-02: 오래 켜 두어도 메모리 속 목록이 끝없이 늘지 않는다."""

from __future__ import annotations

from pathlib import Path

from chamgap.tracking import KEEP_S, MAX_SAMPLES, History

from .sim import Sim


def test_history_is_bounded_by_time_and_count() -> None:
    h = History()
    t0 = 1_792_713_600.0
    for i in range(30000):  # 1초마다 8시간 이상
        h.add(t0 + i, {"temp_a": 23.0 + (i % 10) * 0.01})
        h.add_event(t0 + i, "seq_gap", missed=1)
    assert len(h.samples) <= MAX_SAMPLES
    assert h.samples[-1].ts - h.samples[0].ts <= KEEP_S
    assert len(h.events) <= 2000


def test_long_run_keeps_structures_small(tmp_path: Path) -> None:
    sim = Sim(tmp_path, nodes=("Z1", "Z2", "Z3"))
    for _ in range(6):
        sim.run(20 * 60, step=10)  # 2시간
        for k in sim.mocks:
            sim.cmd(k, "water 5")
    node = sim.hub.nodes["Z1"]
    assert len(node.recent) <= 50
    assert len(sim.hub.waters["Z1"].soil_runs) <= 5
    assert len(sim.mocks["Z1"].waters) <= 10
    assert sim.hub._msg_waiters == []
    assert all(len(t) == len(sim.hub.engine.rules) for t in sim.hub.engine.tracks.values())
    sim.close()
