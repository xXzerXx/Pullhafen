"""Prüft, ob für ein eingebundenes Werkzeug (aktuell: yt-dlp) auf PyPI eine
neuere Version als die installierte vorliegt - reiner Hinweis in den
Einstellungen, kein automatisches Update. yt-dlp selbst bricht ziemlich
häufig durch Extractor-Änderungen auf den Videoseiten, darum lohnt sich hier
ein echter Hinweis statt "läuft schon", statt dass man es erst merkt, wenn
ein Download plötzlich fehlschlägt."""

import httpx
import yt_dlp

PYPI_TIMEOUT_SECONDS = 5.0


class ToolVersionInfo:
    def __init__(self, name: str, installed: str, latest: str | None):
        self.name = name
        self.installed = installed
        self.latest = latest
        # None (PyPI nicht erreichbar) heißt "unbekannt", nicht "aktuell" -
        # wird im Frontend auch so unterschieden (siehe ToolVersionOut).
        self.update_available = latest is not None and latest != installed


async def _latest_pypi_version(client: httpx.AsyncClient, package: str) -> str | None:
    try:
        response = await client.get(f"https://pypi.org/pypi/{package}/json", timeout=PYPI_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.json()["info"]["version"]
    except Exception:  # noqa: BLE001 — kein Internet/PyPI down blockt die Einstellungsseite nicht
        return None


async def check_tool_versions() -> list[ToolVersionInfo]:
    async with httpx.AsyncClient() as client:
        latest = await _latest_pypi_version(client, "yt-dlp")
    return [ToolVersionInfo(name="yt-dlp", installed=yt_dlp.version.__version__, latest=latest)]
