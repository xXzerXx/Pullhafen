from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.models import Item, RestrictedDomain
from app.services.settings import get_setting, set_setting

AGE_LIMIT_THRESHOLD_KEY = "restricted_age_limit_threshold"
DEFAULT_AGE_LIMIT_THRESHOLD = 18


def get_age_limit_threshold(db: Session) -> int:
    raw = get_setting(db, AGE_LIMIT_THRESHOLD_KEY, "")
    if not raw:
        return DEFAULT_AGE_LIMIT_THRESHOLD
    return int(raw)


def set_age_limit_threshold(db: Session, threshold: int) -> None:
    if threshold < 0:
        raise ValueError("Der Schwellenwert darf nicht negativ sein.")
    set_setting(db, AGE_LIMIT_THRESHOLD_KEY, str(threshold))


def domain_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def is_restricted(item: Item, restricted_domains: set[str], age_limit_threshold: int) -> bool:
    """Reine Lesefunktion, absichtlich nirgends gespeichert (siehe Plan) -
    Schwellenwert- oder Domainlisten-Änderungen wirken dadurch sofort
    rückwirkend auf bereits vorhandene Items, ohne irgendwas neu
    berechnen/migrieren zu müssen.

    Ebene 1 (manueller Override) gewinnt immer, danach Ebene 2 (eigene
    Domain-Liste), danach Ebene 3 (yt-dlp's age_limit gegen den
    Schwellenwert) - nicht jede Seite liefert age_limit, genau deshalb die
    beiden Fallbacks davor."""
    if item.restricted_override is not None:
        return item.restricted_override
    if domain_of(item.url) in restricted_domains:
        return True
    return item.age_limit >= age_limit_threshold


def restricted_domains_set(db: Session) -> set[str]:
    return {row.domain for row in db.query(RestrictedDomain).all()}
