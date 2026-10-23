from __future__ import annotations

from chamgap.config import Config
from chamgap.netinfo import _width, banner, urls


def test_urls_and_banner() -> None:
    assert urls(8000, ["192.168.0.12"]) == ["http://192.168.0.12:8000"]
    b = banner(Config(), web_built=False)
    assert "참값 브리지 서버" in b and "/docs" in b and b.startswith("┏")
    lines = b.splitlines()
    assert len({_width(x) for x in lines}) == 1  # 상자 폭이 고르다
