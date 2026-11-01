import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

item_tags = Table(
    "item_tags",
    Base.metadata,
    Column("item_id", ForeignKey("items.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

item_performers = Table(
    "item_performers",
    Base.metadata,
    Column("item_id", ForeignKey("items.id"), primary_key=True),
    Column("performer_id", ForeignKey("performers.id"), primary_key=True),
)


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
    # Ebene 1 der Einschränkungs-Logik (app.services.restricted): None =
    # kein manueller Override, True/False erzwingt eingeschränkt/nicht
    # eingeschränkt unabhängig von Domain-Liste und age_limit.
    restricted_override: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Getrennt vom echten Lade-Status (siehe Plan, Architektur) - ein
    # abgeschlossener Download bleibt im Downloads-Reiter sichtbar, bis
    # "Aufräumen" geklickt wird oder "automatisch entfernen" aktiv ist. Die
    # Bibliothek ignoriert dieses Feld komplett, nichts verschwindet dort je.
    hidden_from_downloads: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    tags: Mapped[list["Tag"]] = relationship(secondary=item_tags, back_populates="items")
    performers: Mapped[list["Performer"]] = relationship(secondary=item_performers, back_populates="items")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    items: Mapped[list[Item]] = relationship(secondary=item_tags, back_populates="tags")


class Performer(Base):
    __tablename__ = "performers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    items: Mapped[list[Item]] = relationship(secondary=item_performers, back_populates="performers")


class RestrictedDomain(Base):
    """Ebene 2 der Einschränkungs-Logik: Domains, die unabhängig von
    age_limit immer als eingeschränkt gelten."""

    __tablename__ = "restricted_domains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain: Mapped[str] = mapped_column(String, nullable=False, unique=True)
