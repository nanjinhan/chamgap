"""연결 방식별 Link 만들기."""

from __future__ import annotations

from ..clock import Clock
from ..config import Config
from .base import Link


def make_link(cfg: Config, clock: Clock) -> Link:
    if cfg.mode == "serial":
        from .serial_link import SerialLink

        return SerialLink(cfg.serial.ports, cfg.serial.baud)
    if cfg.mode == "mqtt":
        from .mqtt_link import MqttLink

        return MqttLink(cfg.mqtt.host, cfg.mqtt.port)
    from .mock_link import MockLink

    return MockLink(speed=cfg.mock.speed, scenarios=cfg.mock.scenarios, clock=clock)


__all__ = ["Link", "make_link"]
