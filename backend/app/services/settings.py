from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

from app.config import DOWNLOADS_DIR
from app.models import Setting

DOWNLOADS_SUBPATH_KEY = "downloads_subpath"

MAX_CONCURRENT_DOWNLOADS_KEY = "max_concurrent_downloads"
DEFAULT_MAX_CONCURRENT_DOWNLOADS = 3

DEFAULT_QUALITY_KEY = "default_quality"
DEFAULT_QUALITY_FORMAT = "bestvideo+bestaudio/best"

AUTOSTART_KEY = "autostart"
DEFAULT_AUTOSTART = True

AUTO_REMOVE_COMPLETED_KEY = "auto_remove_completed"
DEFAULT_AUTO_REMOVE_COMPLETED = False


def _get_bool(db: Session, key: str, default: bool) -> bool:
    raw = get_setting(db, key, "")
    if not raw:
        return default
    return raw == "true"


def _set_bool(db: Session, key: str, value: bool) -> None:
    set_setting(db, key, "true" if value else "false")


def get_max_concurrent_downloads(db: Session) -> int:
    raw = get_setting(db, MAX_CONCURRENT_DOWNLOADS_KEY, "")
    return int(raw) if raw else DEFAULT_MAX_CONCURRENT_DOWNLOADS


def set_max_concurrent_downloads(db: Session, value: int) -> None:
    if value < 1:
        raise ValueError("Es muss mindestens ein gleichzeitiger Download erlaubt sein.")
    set_setting(db, MAX_CONCURRENT_DOWNLOADS_KEY, str(value))


def get_default_quality(db: Session) -> str:
    return get_setting(db, DEFAULT_QUALITY_KEY, "") or DEFAULT_QUALITY_FORMAT


def set_default_quality(db: Session, value: str) -> None:
    clean = value.strip()
    if not clean:
        raise ValueError("Der Qualitäts-Formatstring darf nicht leer sein.")
    set_setting(db, DEFAULT_QUALITY_KEY, clean)


def get_autostart(db: Session) -> bool:
    return _get_bool(db, AUTOSTART_KEY, DEFAULT_AUTOSTART)


def set_autostart(db: Session, value: bool) -> None:
    _set_bool(db, AUTOSTART_KEY, value)


def get_auto_remove_completed(db: Session) -> bool:
    return _get_bool(db, AUTO_REMOVE_COMPLETED_KEY, DEFAULT_AUTO_REMOVE_COMPLETED)


def set_auto_remove_completed(db: Session, value: bool) -> None:
    _set_bool(db, AUTO_REMOVE_COMPLETED_KEY, value)


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row is not None else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    db.commit()


class InvalidSubpathError(ValueError):
    pass


def validate_downloads_subpath(subpath: str) -> str:
    """Normalisiert den Unterpfad und lehnt jeden Versuch ab, aus dem
    gemounteten Downloads-Volume herauszuführen (z.B. per '..' oder einem
    absoluten Pfad). Die Absolut-Prüfung läuft bewusst VOR dem Abschneiden
    führender Schrägstriche, sonst würde '/etc' leise zu 'etc' werden statt
    abgelehnt zu werden."""
    raw = subpath.strip()
    if not raw:
        return ""
    if raw.startswith(("/", "\\")) or PurePosixPath(raw).is_absolute():
        raise InvalidSubpathError("Der Unterpfad muss relativ sein (kein absoluter Pfad).")
    pure = PurePosixPath(raw)
    if ".." in pure.parts:
        raise InvalidSubpathError("Der Unterpfad darf kein '..' enthalten.")
    return pure.as_posix()


def resolve_downloads_root(db: Session) -> Path:
    subpath = get_setting(db, DOWNLOADS_SUBPATH_KEY, "")
    root = (DOWNLOADS_DIR / subpath).resolve() if subpath else DOWNLOADS_DIR.resolve()
    base = DOWNLOADS_DIR.resolve()
    if base not in (root, *root.parents):
        # Sollte durch validate_downloads_subpath() bereits verhindert sein;
        # hier nur als letzte, echte Grenze vor dem Dateisystem.
        raise InvalidSubpathError("Aufgelöster Pfad liegt außerhalb des Downloads-Volumes.")
    return root
