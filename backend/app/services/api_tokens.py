import hashlib
import secrets

from sqlalchemy.orm import Session

from app.models import ApiToken

TOKEN_PREFIX = "pullhafen_"


def _hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_token(db: Session, label: str) -> tuple[ApiToken, str]:
    """Gibt das DB-Objekt UND den Klartext-Token zurück - der Klartext wird
    nirgends gespeichert, das ist der einzige Moment, in dem er existiert."""
    raw_token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token = ApiToken(label=label, token_hash=_hash(raw_token))
    db.add(token)
    db.commit()
    db.refresh(token)
    return token, raw_token


def verify_token(db: Session, raw_token: str) -> ApiToken | None:
    return db.query(ApiToken).filter(ApiToken.token_hash == _hash(raw_token)).first()


def delete_token(db: Session, token_id: int) -> bool:
    token = db.get(ApiToken, token_id)
    if token is None:
        return False
    db.delete(token)
    db.commit()
    return True
