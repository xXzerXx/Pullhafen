from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Weitere Tabellen (items, tags, performers, restricted_domains, ...)
# folgen in Stufe 3+. `settings` kommt vorgezogen, weil der Downloadordner
# als Einstellung schon jetzt gebraucht wird.


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False, default="")
