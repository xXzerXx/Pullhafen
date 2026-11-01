import asyncio

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models import Item
from app.services.auth import (
    bootstrap_admin_if_needed,
    get_or_create_session_secret,
    verify_login,
)
from app.services import download_manager as dm
from app.services.engines import ytdlp_engine
from app.services.ws_manager import manager as ws_manager
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


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    # SessionMiddleware liest das Session-Cookie auch beim WebSocket-
    # Handshake aus (gleicher Ablauf wie bei HTTP-Requests).
    if not websocket.session.get("username"):
        await websocket.close(code=1008)
        return
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(websocket)


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


class LinkIn(BaseModel):
    url: str


class ItemOut(BaseModel):
    id: int
    url: str
    engine: str
    status: str
    filename: str | None
    file_path: str | None
    bytes_downloaded: int
    total_bytes: int | None
    error_message: str | None
    source: str | None
    age_limit: int

    @classmethod
    def from_item(cls, item: Item) -> "ItemOut":
        return cls(
            id=item.id,
            url=item.url,
            engine=item.engine,
            status=item.status,
            filename=item.filename,
            file_path=item.file_path,
            bytes_downloaded=item.bytes_downloaded,
            total_bytes=item.total_bytes,
            error_message=item.error_message,
            source=item.source,
            age_limit=item.age_limit,
        )


@app.post("/api/links", response_model=ItemOut)
async def add_link(
    body: LinkIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ItemOut:
    # Echter yt-dlp-Trockenlauf entscheidet: erkanntes Video -> ytdlp-Engine,
    # keine Seite zuständig -> generischer httpx-Download, bekannte Seite
    # aber Video kaputt -> klar als gescheiterter Video-Download melden
    # (nicht als generischer Download der Fehlerseite durchrutschen lassen).
    try:
        info = await asyncio.to_thread(ytdlp_engine.classify, body.url)
    except ytdlp_engine.VideoUnavailableError as exc:
        item = Item(url=body.url, engine="ytdlp", status="failed", error_message=str(exc))
        db.add(item)
        db.commit()
        db.refresh(item)
        await ws_manager.broadcast({"type": "item_update", "item": ItemOut.from_item(item).model_dump()})
        return ItemOut.from_item(item)

    if info is not None:
        item = Item(
            url=body.url,
            engine="ytdlp",
            status="queued",
            source=info.get("extractor_key"),
            age_limit=info.get("age_limit") or 0,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        dm.queue_ytdlp_download(item.id)
    else:
        item = Item(url=body.url, engine="http", status="queued")
        db.add(item)
        db.commit()
        db.refresh(item)
        dm.queue_generic_download(item.id)
    await ws_manager.broadcast({"type": "item_update", "item": ItemOut.from_item(item).model_dump()})
    return ItemOut.from_item(item)


@app.get("/api/items/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    return ItemOut.from_item(item)


@app.get("/api/items", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db), _: str = Depends(require_login)) -> list[ItemOut]:
    items = db.query(Item).order_by(Item.id).all()
    return [ItemOut.from_item(item) for item in items]


@app.post("/api/items/{item_id}/pause", response_model=ItemOut)
async def pause_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status not in ("downloading", "queued"):
        raise HTTPException(status_code=400, detail="Nur ein laufender Download kann pausiert werden.")
    if not dm.pause_item(item.id):
        raise HTTPException(status_code=409, detail="Download läuft gerade nicht aktiv.")
    return ItemOut.from_item(item)


@app.post("/api/items/{item_id}/resume", response_model=ItemOut)
async def resume_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status != "paused":
        raise HTTPException(status_code=400, detail="Nur ein pausierter Download kann fortgesetzt werden.")
    if dm.is_active(item.id):
        raise HTTPException(status_code=409, detail="Download läuft bereits.")
    if item.engine == "http":
        dm.queue_generic_download(item.id)
    else:
        dm.queue_ytdlp_download(item.id)
    return ItemOut.from_item(item)


@app.post("/api/items/{item_id}/restart", response_model=ItemOut)
async def restart_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status not in ("paused", "failed", "completed"):
        raise HTTPException(status_code=400, detail="Dieser Status kann nicht neu gestartet werden.")
    if dm.is_active(item.id):
        raise HTTPException(status_code=409, detail="Download läuft gerade - zuerst pausieren.")
    if item.engine == "http":
        dm.queue_generic_download(item.id, restart=True)
    else:
        dm.queue_ytdlp_download(item.id, restart=True)
    return ItemOut.from_item(item)
