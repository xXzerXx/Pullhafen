import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("PULLHAFEN_DATA_DIR", BACKEND_ROOT / "data"))
DOWNLOADS_DIR = Path(os.environ.get("PULLHAFEN_DOWNLOADS_DIR", BACKEND_ROOT / "downloads"))
DATABASE_PATH = DATA_DIR / "pullhafen.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"
# Vite baut hierhin (siehe frontend/vite.config.ts) - im Dev-Betrieb läuft
# stattdessen Vites eigener Dev-Server mit Proxy auf dieses Backend.
STATIC_DIR = BACKEND_ROOT / "app" / "static"
