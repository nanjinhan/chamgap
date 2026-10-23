"""설정 읽기: config.yaml + 명령줄 옵션 덮어쓰기."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator

SERVER_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = SERVER_DIR / "config.yaml"
DEFAULT_DIAGNOSTICS = Path(__file__).resolve().parent / "diagnostics" / "diagnostics.yaml"

Mode = Literal["serial", "mqtt", "mock"]


class SerialCfg(BaseModel):
    ports: list[str] = Field(default_factory=list)
    baud: int = 115200


class MqttCfg(BaseModel):
    host: str = "127.0.0.1"
    port: int = 1883


class MockCfg(BaseModel):
    speed: float = 1.0
    scenarios: dict[str, str] = Field(default_factory=dict)


class ServerCfg(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000
    allow_raw: bool = True
    pin: str | None = None

    @field_validator("pin", mode="before")
    @classmethod
    def _pin_to_str(cls, v: Any) -> str | None:
        if v is None or v == "":
            return None
        return str(v)


class SafetyCfg(BaseModel):
    max_ml_per_shot: float = 50.0
    max_ml_per_day: float = 300.0


class StorageCfg(BaseModel):
    keep_days: int = 30
    log_dir: str = "logs"
    data_dir: str = "data"


class Config(BaseModel):
    mode: Mode = "mock"
    serial: SerialCfg = Field(default_factory=SerialCfg)
    mqtt: MqttCfg = Field(default_factory=MqttCfg)
    mock: MockCfg = Field(default_factory=MockCfg)
    server: ServerCfg = Field(default_factory=ServerCfg)
    safety: SafetyCfg = Field(default_factory=SafetyCfg)
    storage: StorageCfg = Field(default_factory=StorageCfg)
    diagnostics_file: str | None = None
    base_dir: Path = SERVER_DIR

    def path(self, rel: str) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else self.base_dir / p

    # mock(가짜 ESP32) 기록은 실제 기록과 섞이지 않게 mock/ 하위 폴더에 따로 둔다
    @property
    def log_dir(self) -> Path:
        base = self.path(self.storage.log_dir)
        return base / "mock" if self.mode == "mock" else base

    @property
    def data_dir(self) -> Path:
        base = self.path(self.storage.data_dir)
        return base / "mock" if self.mode == "mock" else base

    @property
    def diagnostics_path(self) -> Path:
        return self.path(self.diagnostics_file) if self.diagnostics_file else DEFAULT_DIAGNOSTICS

    @property
    def web_dist(self) -> Path:
        return self.base_dir.parent / "web" / "dist"


def parse_scenarios(items: list[str] | None) -> dict[str, str]:
    """['Z2=soil_a_unplugged'] → {'Z2': 'soil_a_unplugged'}"""
    out: dict[str, str] = {}
    for item in items or []:
        if "=" not in item:
            raise ValueError(f"--scenario 형식은 구역=시나리오 입니다 (받은 값: {item})")
        node, name = item.split("=", 1)
        out[node.strip().upper()] = name.strip()
    return out


def load_config(path: Path | None = None, args: argparse.Namespace | None = None) -> Config:
    cfg_path = path or (args.config if args and getattr(args, "config", None) else None) or DEFAULT_CONFIG
    raw: dict[str, Any] = {}
    if cfg_path.exists():
        with cfg_path.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    cfg = Config.model_validate(raw)
    if args is not None:
        _apply_args(cfg, args)
    return cfg


def _apply_args(cfg: Config, args: argparse.Namespace) -> None:
    if getattr(args, "mode", None):
        cfg.mode = args.mode
    if getattr(args, "ports", None):
        cfg.serial.ports = list(args.ports)
    if getattr(args, "baud", None):
        cfg.serial.baud = args.baud
    if getattr(args, "mqtt_host", None):
        cfg.mqtt.host = args.mqtt_host
    if getattr(args, "mqtt_port", None):
        cfg.mqtt.port = args.mqtt_port
    if getattr(args, "mock_speed", None):
        cfg.mock.speed = args.mock_speed
    if getattr(args, "scenario", None):
        cfg.mock.scenarios.update(parse_scenarios(args.scenario))
    if getattr(args, "host", None):
        cfg.server.host = args.host
    if getattr(args, "http_port", None):
        cfg.server.port = args.http_port
    if getattr(args, "no_raw", False):
        cfg.server.allow_raw = False
    if getattr(args, "pin", None):
        cfg.server.pin = str(args.pin)
