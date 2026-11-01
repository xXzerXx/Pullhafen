import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# tags/performers/restricted_domains folgen, sobald Stufe 4 (yt-dlp) und
# Stufe 9 (Einschränkungs-Logik) sie brauchen.


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False, default="")


class AdminUser(Base):
    """Genau ein Admin-Konto. Erstanmeldedaten kommen beim allerersten Start
    aus Umgebungsvariablen (siehe app.services.auth), danach lebt nur noch
    diese Zeile hier — ein erneuter Containerstart mit anderen Env-Vars
    überschreibt ein bereits gesetztes Passwort NICHT."""

    __tablename__ = "admin_user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)


class Item(Base):
    """Ein Download, über seinen ganzen Lebenszyklus hinweg (Warteschlange
    -> Download -> Bibliothek), siehe die Architektur-Notiz im Plan.
    Engine ist 'http' (generische Datei) oder 'ytdlp' (erkanntes Video)."""

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    url: Mapped[str] = mapped_column(String, nullable=False)
    engine: Mapped[str] = mapped_column(String, nullable=False, default="http")
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    filename: Mapped[str | None] = mapped_column(String, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String, nullable=True)
    bytes_downloaded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)
    # Nur bei engine='ytdlp' gesetzt: source = extractor_key (z.B. "Youtube"),
    # age_limit = yt-dlp's eigenes Feld (0, wenn die Seite keins liefert),
    # dient Stufe 9 (Einschränkungs-Logik) als erste der drei Regel-Ebenen.
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    age_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )
