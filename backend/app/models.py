from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Weitere Tabellen (items, tags, performers, restricted_domains, ...)
# folgen in Stufe 3+. `settings` kommt vorgezogen, weil der Downloadordner
# als Einstellung schon jetzt gebraucht wird.


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
