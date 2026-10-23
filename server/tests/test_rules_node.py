"""NODE_OFFLINE · NODE_REBOOTED · MSG_GAP"""

from __future__ import annotations

from pathlib import Path

from .sim import Feeder


def test_node_offline_after_3x_sample_or_15s(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(20)
    assert f.hub.nodes["Z1"].online and "NODE_OFFLINE" not in f.codes()
    f.wait(10)  # 마지막 data(16초) 후 14초
    assert "NODE_OFFLINE" not in f.codes()
    f.wait(3)
    d = f.diag("NODE_OFFLINE")
    assert d is not None and d["severity"] == "offline" and "기준 15초" in d["detail"]
    node = f.hub.nodes["Z1"]
    assert not node.online and node.status() == "offline"
    assert all(s["status"] == "offline" for s in node.sensors().values())
    f.data()  # 다시 오면 바로 풀린다
    assert "NODE_OFFLINE" not in f.codes() and f.hub.nodes["Z1"].online
    f.close()


def test_offline_threshold_follows_sample_ms(tmp_path: Path) -> None:
    f = Feeder(tmp_path, sample_ms=10000)  # 3 × 10초 = 30초
    f.run(12, every=10)
    f.wait(25)
    assert "NODE_OFFLINE" not in f.codes()
    f.wait(10)
    assert "NODE_OFFLINE" in f.codes()
    f.close()


def test_offline_hides_other_diagnostics(tmp_path: Path) -> None:
    f = Feeder(tmp_path, soil_cal=0)
    f.run(10)
    assert "SOIL_UNCAL" in f.codes()
    f.wait(20)
    assert f.codes() == {"NODE_OFFLINE"}  # 원인 하나만 (DX-06)
    f.close()


def test_rebooted_on_boot_event(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(10)
    f.evt("boot", fw="node-0.1", reset=9, sht_a=1, sht_b=1)
    f.run(5)
    d = f.diag("NODE_REBOOTED")
    assert d is not None and d["severity"] == "info" and "원인 번호 9" in d["detail"]
    f.run(300)
    assert "NODE_REBOOTED" in f.codes()  # 해제 유지 시간(10초) 동안은 남아 있음
    f.run(15)
    assert "NODE_REBOOTED" not in f.codes()  # 5분 표시 뒤 사라짐
    f.close()


def test_boot_right_after_port_open_is_normal(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.hub.port_opened["COM5"] = f.clock.now()  # 시리얼을 열면 ESP32가 리셋된다
    f.evt("boot", fw="node-0.1", reset=1, sht_a=1, sht_b=1)
    f.run(10)
    assert "NODE_REBOOTED" not in f.codes()
    f.close()


def test_rebooted_when_seq_goes_down(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(30)
    f.seq = 0  # 다음 data는 seq=1
    f.run(5)
    d = f.diag("NODE_REBOOTED")
    assert d is not None and "순번" in d["detail"]
    f.close()


def test_reboot_after_pump_on_is_mentioned(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(10)
    f.evt("pump_on", dur=4000, ml=10.0)
    f.clock.advance(1)
    f.evt("boot", fw="node-0.1", reset=9, sht_a=1, sht_b=1)
    f.run(2)
    d = f.diag("NODE_REBOOTED")
    assert d is not None and "펌프를 켠 직후" in d["detail"]
    f.close()


def test_msg_gap_after_three_skips(tmp_path: Path) -> None:
    f = Feeder(tmp_path)
    f.run(10)
    for _ in range(2):
        f.seq += 1  # 하나 건너뜀
        f.run(5)
    assert "MSG_GAP" not in f.codes()
    f.seq += 2
    f.run(5, rssi=-82)
    d = f.diag("MSG_GAP")
    assert d is not None and d["severity"] == "warn" and "3번" in d["detail"] and "WiFi 약함" in d["detail"]
    f.run(620)  # 10분 창을 지나면 풀림
    assert "MSG_GAP" not in f.codes()
    f.close()
