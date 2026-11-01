from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

from app.config import DOWNLOADS_DIR
from app.models import Setting

DOWNLOADS_SUBPATH_KEY = "downloads_subpath"


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
