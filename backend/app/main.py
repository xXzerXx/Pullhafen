from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.services.auth import (
    bootstrap_admin_if_needed,
    get_or_create_session_secret,
    verify_login,
)
from app.services.settings import (
    DOWNLOADS_SUBPATH_KEY,
    InvalidSubpathError,
    get_setting,
    resolve_downloads_root,
    set_setting,
    validate_downloads_subpath,
)

# Admin-Konto bootstrapen und das Session-Secret aus der DB holen (oder beim
# allerersten Start erzeugen), BEVOR die SessionMiddleware registriert wird —
# sie braucht den Secret-Key schon zur Konstruktionszeit.
with SessionLocal() as _startup_db:
    bootstrap_admin_if_needed(_startup_db)
    _session_secret = get_or_create_session_secret(_startup_db)

app = FastAPI(title="Pullhafen")
app.add_middleware(SessionMiddleware, secret_key=_session_secret, https_only=False)


def require_login(request: Request) -> str:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    return username


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> dict:
    if not verify_login(db, body.username, body.password):
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch.")
    request.session["username"] = body.username
    return {"username": body.username}


@app.post("/api/auth/logout")
def logout(request: Request) -> dict:
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(username: str = Depends(require_login)) -> dict:
    return {"username": username}


class DownloadsRootOut(BaseModel):
    subpath: str
    resolved_path: str


class DownloadsRootIn(BaseModel):
    subpath: str


@app.get("/api/settings/downloads-root", response_model=DownloadsRootOut)
def get_downloads_root(
    db: Session = Depends(get_db), _: str = Depends(require_login)
) -> DownloadsRootOut:
    subpath = get_setting(db, DOWNLOADS_SUBPATH_KEY, "")
    return DownloadsRootOut(subpath=subpath, resolved_path=str(resolve_downloads_root(db)))


@app.put("/api/settings/downloads-root", response_model=DownloadsRootOut)
def set_downloads_root(
    body: DownloadsRootIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> DownloadsRootOut:
    try:
        clean = validate_downloads_subpath(body.subpath)
    except InvalidSubpathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    set_setting(db, DOWNLOADS_SUBPATH_KEY, clean)
    return DownloadsRootOut(subpath=clean, resolved_path=str(resolve_downloads_root(db)))
