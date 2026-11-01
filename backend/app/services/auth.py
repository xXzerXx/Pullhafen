import os
import secrets

import bcrypt
from sqlalchemy.orm import Session

from app.models import AdminUser
from app.services.settings import get_setting, set_setting

SESSION_SECRET_KEY_SETTING = "session_secret_key"


class PasswordTooLongError(ValueError):
    pass


def _encode(password: str) -> bytes:
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        # bcrypt selbst lehnt das hart ab (ValueError) statt still zu kürzen
        # — hier nur in eine eigene, sprechende Exception übersetzt.
        raise PasswordTooLongError("Das Passwort darf höchstens 72 Bytes lang sein.")
    return encoded


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(_encode(password), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(password), password_hash.encode("utf-8"))
    except PasswordTooLongError:
        return False


def bootstrap_admin_if_needed(db: Session) -> None:
    """Legt beim allerersten Start das Admin-Konto aus den Umgebungsvariablen
    PULLHAFEN_ADMIN_USERNAME / PULLHAFEN_ADMIN_PASSWORD an. Existiert schon
    ein Admin-Konto, wird nichts verändert — ein späterer Containerstart mit
    anderen Env-Vars setzt ein über die Oberfläche geändertes Passwort nicht
    zurück."""
    if db.query(AdminUser).first() is not None:
        return
    username = os.environ.get("PULLHAFEN_ADMIN_USERNAME")
    password = os.environ.get("PULLHAFEN_ADMIN_PASSWORD")
    if not username or not password:
        raise RuntimeError(
            "Kein Admin-Konto vorhanden und PULLHAFEN_ADMIN_USERNAME/"
            "PULLHAFEN_ADMIN_PASSWORD sind nicht gesetzt — Erstanmeldung "
            "unmöglich."
        )
    db.add(AdminUser(username=username, password_hash=_hash_password(password)))
    db.commit()


# Fixer Dummy-Hash für den Username-nicht-gefunden-Fall, damit die
# Antwortzeit nicht verrät, ob der Benutzername existiert.
_DUMMY_HASH = bcrypt.hashpw(b"dummy", bcrypt.gensalt()).decode("utf-8")


def verify_login(db: Session, username: str, password: str) -> bool:
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if user is None:
        _verify_password(password, _DUMMY_HASH)
        return False
    return _verify_password(password, user.password_hash)


def get_or_create_session_secret(db: Session) -> str:
    secret = get_setting(db, SESSION_SECRET_KEY_SETTING, "")
    if secret:
        return secret
    secret = secrets.token_hex(32)
    set_setting(db, SESSION_SECRET_KEY_SETTING, secret)
    return secret
