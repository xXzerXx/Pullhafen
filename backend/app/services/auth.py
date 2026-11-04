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


DEFAULT_ADMIN_USERNAME = "admin"


def bootstrap_admin_if_needed(db: Session) -> None:
    """Legt beim allerersten Start das Admin-Konto an. PULLHAFEN_ADMIN_USERNAME
    ist optional (Standard "admin", siehe Dockerfile-ENV). Ist
    PULLHAFEN_ADMIN_PASSWORD nicht gesetzt, wird ein zufälliges Passwort
    erzeugt und einmalig, gut sichtbar in die Logs geschrieben - damit
    lässt sich die App ohne jede Pflichteingabe installieren, ohne auf
    admin:admin oder ein anderes vorhersagbares Passwort zurückzufallen.
    Existiert schon ein Admin-Konto, wird nichts verändert - ein späterer
    Containerstart mit anderen Env-Vars setzt ein über die Oberfläche
    geändertes Passwort nicht zurück."""
    if db.query(AdminUser).first() is not None:
        return
    username = os.environ.get("PULLHAFEN_ADMIN_USERNAME") or DEFAULT_ADMIN_USERNAME
    password = os.environ.get("PULLHAFEN_ADMIN_PASSWORD")
    generated = not password
    if generated:
        password = secrets.token_urlsafe(9)
        print(
            "\n"
            "========================================================\n"
            "  Pullhafen - Admin-Erstanmeldung\n"
            f"  Benutzername: {username}\n"
            f"  Passwort:     {password}\n"
            "  (zufällig erzeugt, da PULLHAFEN_ADMIN_PASSWORD nicht\n"
            "  gesetzt war - nach dem ersten Login muss ein eigenes\n"
            "  Passwort festgelegt werden.)\n"
            "========================================================\n",
            flush=True,
        )
    db.add(
        AdminUser(
            username=username,
            password_hash=_hash_password(password),
            must_change_password=True,
        )
    )
    db.commit()


# Fixer Dummy-Hash für den Username-nicht-gefunden-Fall, damit die
# Antwortzeit nicht verrät, ob der Benutzername existiert.
_DUMMY_HASH = bcrypt.hashpw(b"dummy", bcrypt.gensalt()).decode("utf-8")


def must_change_password(db: Session, username: str) -> bool:
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    return user is not None and user.must_change_password


def pending_initial_login_username(db: Session) -> str | None:
    """Für die Login-Seite, VOR jeder Anmeldung: Name des Kontos, das noch
    sein Erstanmelde-Passwort trägt (falls eins existiert) - genug, um auf
    der Login-Seite den Hinweis "Passwort steht in den Logs" einzublenden,
    ohne selbst irgendetwas Geheimes preiszugeben."""
    user = db.query(AdminUser).filter(AdminUser.must_change_password.is_(True)).first()
    return user.username if user is not None else None


def verify_login(db: Session, username: str, password: str) -> bool:
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if user is None:
        _verify_password(password, _DUMMY_HASH)
        return False
    return _verify_password(password, user.password_hash)


class WrongPasswordError(ValueError):
    pass


class UsernameTakenError(ValueError):
    pass


class SelfDeleteError(ValueError):
    pass


class LastAccountError(ValueError):
    pass


def change_password(db: Session, username: str, current_password: str, new_password: str) -> None:
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if user is None or not _verify_password(current_password, user.password_hash):
        raise WrongPasswordError("Aktuelles Passwort ist falsch.")
    user.password_hash = _hash_password(new_password)
    user.must_change_password = False
    db.commit()


def list_usernames(db: Session) -> list[str]:
    return [u.username for u in db.query(AdminUser).order_by(AdminUser.username).all()]


def create_user(
    db: Session,
    requesting_username: str,
    requesting_password: str,
    new_username: str,
    new_password: str,
) -> None:
    """Legt ein weiteres Konto an - erfordert das eigene aktuelle Passwort
    des schon eingeloggten Nutzers als Bestätigung (Thomas' Wunsch:
    sicherheitsrelevante Kontoänderungen immer übers eigene Passwort
    bestätigen, nicht nur über die aktive Session/den Cookie)."""
    if not verify_login(db, requesting_username, requesting_password):
        raise WrongPasswordError("Aktuelles Passwort ist falsch.")
    new_username = new_username.strip()
    if not new_username:
        raise ValueError("Benutzername darf nicht leer sein.")
    if db.query(AdminUser).filter(AdminUser.username == new_username).first() is not None:
        raise UsernameTakenError("Dieser Benutzername ist schon vergeben.")
    db.add(AdminUser(username=new_username, password_hash=_hash_password(new_password)))
    db.commit()


def delete_user(db: Session, requesting_username: str, requesting_password: str, target_username: str) -> None:
    """Entfernt ein Konto - ebenfalls übers eigene aktuelle Passwort bestätigt.
    Das eigene Konto kann hier nicht gelöscht werden (würde die eigene
    Session verwaisen lassen), und es muss immer mindestens ein Konto
    übrig bleiben, damit niemand sich selbst aussperrt."""
    if not verify_login(db, requesting_username, requesting_password):
        raise WrongPasswordError("Aktuelles Passwort ist falsch.")
    if target_username == requesting_username:
        raise SelfDeleteError("Das eigene Konto kann hier nicht gelöscht werden.")
    user = db.query(AdminUser).filter(AdminUser.username == target_username).first()
    if user is None:
        raise ValueError("Konto nicht gefunden.")
    if db.query(AdminUser).count() <= 1:
        raise LastAccountError("Es muss mindestens ein Konto übrig bleiben.")
    db.delete(user)
    db.commit()


def get_or_create_session_secret(db: Session) -> str:
    secret = get_setting(db, SESSION_SECRET_KEY_SETTING, "")
    if secret:
        return secret
    secret = secrets.token_hex(32)
    set_setting(db, SESSION_SECRET_KEY_SETTING, secret)
    return secret
