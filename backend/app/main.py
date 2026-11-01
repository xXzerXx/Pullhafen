import asyncio

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session

from app.config import STATIC_DIR
from app.database import SessionLocal, get_db
from app.models import ApiToken, Item, Performer, RestrictedDomain, Tag
from app.services import api_tokens as api_tokens_service
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
    get_auto_remove_completed,
    get_autostart,
    get_default_quality,
    get_max_concurrent_downloads,
    get_setting,
    resolve_downloads_root,
    set_auto_remove_completed,
    set_autostart,
    set_default_quality,
    set_max_concurrent_downloads,
    set_setting,
    validate_downloads_subpath,
)
from app.services import restricted as restricted_service

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


def require_api_token(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> ApiToken:
    """Separater Auth-Pfad für die Browser-Extension (Stufe 12) - die hat
    keine Browser-Session, darum Bearer-Token statt Session-Cookie."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Fehlender oder ungültiger Authorization-Header.")
    raw_token = authorization.removeprefix("Bearer ").strip()
    token = api_tokens_service.verify_token(db, raw_token)
    if token is None:
        raise HTTPException(status_code=401, detail="Ungültiger Token.")
    return token


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
    tags: list[str]
    performers: list[str]
    restricted_override: bool | None
    restricted: bool
    hidden_from_downloads: bool

    @classmethod
    def from_item(
        cls, item: Item, restricted_domains: set[str], age_limit_threshold: int
    ) -> "ItemOut":
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
            tags=sorted(tag.name for tag in item.tags),
            performers=sorted(performer.name for performer in item.performers),
            restricted_override=item.restricted_override,
            restricted=restricted_service.is_restricted(
                item, restricted_domains, age_limit_threshold
            ),
            hidden_from_downloads=item.hidden_from_downloads,
        )


def _restricted_context(db: Session) -> tuple[set[str], int]:
    return (
        restricted_service.restricted_domains_set(db),
        restricted_service.get_age_limit_threshold(db),
    )


async def _create_link_item(url: str, db: Session) -> ItemOut:
    """Gemeinsame Logik für /api/links (Session-Auth) und
    /api/extension/links (Bearer-Token) - derselbe Trockenlauf, dieselbe
    Engine-Entscheidung, derselbe WS-Broadcast, nur der Auth-Pfad
    unterscheidet sich zwischen den beiden Endpunkten."""
    # Echter yt-dlp-Trockenlauf entscheidet: erkanntes Video -> ytdlp-Engine,
    # keine Seite zuständig -> generischer httpx-Download, bekannte Seite
    # aber Video kaputt -> klar als gescheiterter Video-Download melden
    # (nicht als generischer Download der Fehlerseite durchrutschen lassen).
    try:
        info = await asyncio.to_thread(ytdlp_engine.classify, url)
    except ytdlp_engine.VideoUnavailableError as exc:
        item = Item(url=url, engine="ytdlp", status="failed", error_message=str(exc))
        db.add(item)
        db.commit()
        db.refresh(item)
        domains, threshold = _restricted_context(db)
        out = ItemOut.from_item(item, domains, threshold)
        await ws_manager.broadcast({"type": "item_update", "item": out.model_dump()})
        return out

    autostart = get_autostart(db)
    if info is not None:
        item = Item(
            url=url,
            engine="ytdlp",
            status="queued",
            source=info.get("extractor_key"),
            age_limit=info.get("age_limit") or 0,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        if autostart:
            dm.queue_ytdlp_download(item.id)
    else:
        item = Item(url=url, engine="http", status="queued")
        db.add(item)
        db.commit()
        db.refresh(item)
        if autostart:
            dm.queue_generic_download(item.id)
    domains, threshold = _restricted_context(db)
    out = ItemOut.from_item(item, domains, threshold)
    await ws_manager.broadcast({"type": "item_update", "item": out.model_dump()})
    return out


@app.post("/api/links", response_model=ItemOut)
async def add_link(
    body: LinkIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ItemOut:
    return await _create_link_item(body.url, db)


@app.post("/api/extension/links", response_model=ItemOut)
async def add_extension_link(
    body: LinkIn, db: Session = Depends(get_db), _: ApiToken = Depends(require_api_token)
) -> ItemOut:
    return await _create_link_item(body.url, db)


@app.get("/api/items/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.get("/api/items", response_model=list[ItemOut])
def list_items(
    status: str | None = None,
    search: str | None = None,
    tag: str | None = None,
    performer: str | None = None,
    source: str | None = None,
    restricted: bool | None = None,
    include_hidden: bool = False,
    db: Session = Depends(get_db),
    _: str = Depends(require_login),
) -> list[ItemOut]:
    """EIN Endpunkt bedient alle Inhalts-Reiter (Warteschlange/Downloads/
    Bibliothek) über Status- und Facettenfilter, statt für jeden Reiter
    einen eigenen Endpunkt zu brauchen (siehe Plan, API-Oberfläche).
    'restricted' wird NICHT in SQL gefiltert - es ist eine reine
    Lesefunktion (siehe app.services.restricted), die hier nach dem Laden
    angewendet wird. include_hidden=False (Standard) ist die Downloads-/
    Warteschlangen-Sicht - 'aufgeräumte' Items verschwinden daraus. Die
    Bibliothek übergibt include_hidden=True und ignoriert das Feld damit
    komplett, wie im Plan beschrieben."""
    query = db.query(Item)
    if not include_hidden:
        query = query.filter(Item.hidden_from_downloads == False)  # noqa: E712
    if status is not None:
        query = query.filter(Item.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter((Item.filename.ilike(like)) | (Item.url.ilike(like)))
    if tag is not None:
        query = query.join(Item.tags).filter(Tag.name == tag)
    if performer is not None:
        query = query.join(Item.performers).filter(Performer.name == performer)
    if source is not None:
        query = query.filter(Item.source == source)
    items = query.order_by(Item.id).all()
    domains, threshold = _restricted_context(db)
    out = [ItemOut.from_item(item, domains, threshold) for item in items]
    if restricted is not None:
        out = [o for o in out if o.restricted == restricted]
    return out


class TagsIn(BaseModel):
    tags: list[str]


class PerformersIn(BaseModel):
    performers: list[str]


def _get_or_create(db: Session, model: type, name: str):
    clean = name.strip()
    existing = db.query(model).filter(model.name == clean).first()
    if existing is not None:
        return existing
    created = model(name=clean)
    db.add(created)
    db.flush()
    return created


@app.put("/api/items/{item_id}/tags", response_model=ItemOut)
def set_item_tags(
    item_id: int, body: TagsIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    names = {name.strip() for name in body.tags if name.strip()}
    item.tags = [_get_or_create(db, Tag, name) for name in sorted(names)]
    db.commit()
    db.refresh(item)
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.put("/api/items/{item_id}/performers", response_model=ItemOut)
def set_item_performers(
    item_id: int, body: PerformersIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    names = {name.strip() for name in body.performers if name.strip()}
    item.performers = [_get_or_create(db, Performer, name) for name in sorted(names)]
    db.commit()
    db.refresh(item)
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.get("/api/tags", response_model=list[str])
def list_tags(db: Session = Depends(get_db), _: str = Depends(require_login)) -> list[str]:
    return [t.name for t in db.query(Tag).order_by(Tag.name).all()]


@app.get("/api/performers", response_model=list[str])
def list_performers(db: Session = Depends(get_db), _: str = Depends(require_login)) -> list[str]:
    return [p.name for p in db.query(Performer).order_by(Performer.name).all()]


@app.post("/api/items/{item_id}/pause", response_model=ItemOut)
async def pause_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status not in ("downloading", "queued"):
        raise HTTPException(status_code=400, detail="Nur ein laufender Download kann pausiert werden.")
    if not dm.pause_item(item.id):
        raise HTTPException(status_code=409, detail="Download läuft gerade nicht aktiv.")
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


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
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.post("/api/items/{item_id}/restart", response_model=ItemOut)
async def restart_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status not in ("paused", "failed", "completed"):
        raise HTTPException(status_code=400, detail="Dieser Status kann nicht neu gestartet werden.")
    if dm.is_active(item.id):
        raise HTTPException(status_code=409, detail="Download läuft gerade - zuerst pausieren.")
    item.hidden_from_downloads = False
    db.commit()
    if item.engine == "http":
        dm.queue_generic_download(item.id, restart=True)
    else:
        dm.queue_ytdlp_download(item.id, restart=True)
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.post("/api/items/{item_id}/start", response_model=ItemOut)
async def start_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    """Für Items, die wegen autostart=false noch nie wirklich gestartet
    wurden (status bleibt 'queued', ohne registrierten Task)."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status != "queued":
        raise HTTPException(status_code=400, detail="Nur ein wartendes Item kann gestartet werden.")
    if dm.is_active(item.id):
        raise HTTPException(status_code=409, detail="Download läuft bereits.")
    if item.engine == "http":
        dm.queue_generic_download(item.id)
    else:
        dm.queue_ytdlp_download(item.id)
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.post("/api/downloads/cleanup")
def cleanup_downloads(db: Session = Depends(get_db), _: str = Depends(require_login)) -> dict:
    """Blendet abgeschlossene Downloads aus dem Downloads-Reiter aus (die
    Bibliothek bleibt unberührt, siehe Item.hidden_from_downloads)."""
    count = (
        db.query(Item)
        .filter(Item.status == "completed", Item.hidden_from_downloads == False)  # noqa: E712
        .update({Item.hidden_from_downloads: True})
    )
    db.commit()
    return {"removed": count}


class RestrictedOverrideIn(BaseModel):
    override: bool | None


@app.patch("/api/items/{item_id}/restricted-override", response_model=ItemOut)
def set_restricted_override(
    item_id: int,
    body: RestrictedOverrideIn,
    db: Session = Depends(get_db),
    _: str = Depends(require_login),
) -> ItemOut:
    """Ebene 1 der Einschränkungs-Logik. override=None löscht den manuellen
    Override wieder (dann entscheiden Domain-Liste/age_limit)."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    item.restricted_override = body.override
    db.commit()
    db.refresh(item)
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


class RestrictedDomainIn(BaseModel):
    domain: str


@app.get("/api/settings/restricted-domains", response_model=list[str])
def list_restricted_domains(db: Session = Depends(get_db), _: str = Depends(require_login)) -> list[str]:
    return sorted(restricted_service.restricted_domains_set(db))


@app.post("/api/settings/restricted-domains", response_model=list[str])
def add_restricted_domain(
    body: RestrictedDomainIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> list[str]:
    clean = restricted_service.domain_of(f"//{body.domain.strip()}") or body.domain.strip().lower()
    if not clean:
        raise HTTPException(status_code=400, detail="Leere Domain.")
    if db.query(RestrictedDomain).filter(RestrictedDomain.domain == clean).first() is None:
        db.add(RestrictedDomain(domain=clean))
        db.commit()
    return sorted(restricted_service.restricted_domains_set(db))


@app.delete("/api/settings/restricted-domains/{domain}", response_model=list[str])
def remove_restricted_domain(
    domain: str, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> list[str]:
    db.query(RestrictedDomain).filter(RestrictedDomain.domain == domain.lower()).delete()
    db.commit()
    return sorted(restricted_service.restricted_domains_set(db))


class RestrictedThresholdOut(BaseModel):
    threshold: int


class RestrictedThresholdIn(BaseModel):
    threshold: int


@app.get("/api/settings/restricted-threshold", response_model=RestrictedThresholdOut)
def get_restricted_threshold(
    db: Session = Depends(get_db), _: str = Depends(require_login)
) -> RestrictedThresholdOut:
    return RestrictedThresholdOut(threshold=restricted_service.get_age_limit_threshold(db))


@app.put("/api/settings/restricted-threshold", response_model=RestrictedThresholdOut)
def set_restricted_threshold(
    body: RestrictedThresholdIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> RestrictedThresholdOut:
    try:
        restricted_service.set_age_limit_threshold(db, body.threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RestrictedThresholdOut(threshold=restricted_service.get_age_limit_threshold(db))


class AppSettingsOut(BaseModel):
    max_concurrent_downloads: int
    default_quality: str
    autostart: bool
    auto_remove_completed: bool
    downloads_subpath: str
    resolved_downloads_path: str


class AppSettingsIn(BaseModel):
    max_concurrent_downloads: int | None = None
    default_quality: str | None = None
    autostart: bool | None = None
    auto_remove_completed: bool | None = None


def _app_settings_out(db: Session) -> AppSettingsOut:
    return AppSettingsOut(
        max_concurrent_downloads=get_max_concurrent_downloads(db),
        default_quality=get_default_quality(db),
        autostart=get_autostart(db),
        auto_remove_completed=get_auto_remove_completed(db),
        downloads_subpath=get_setting(db, DOWNLOADS_SUBPATH_KEY, ""),
        resolved_downloads_path=str(resolve_downloads_root(db)),
    )


@app.get("/api/settings", response_model=AppSettingsOut)
def get_app_settings(db: Session = Depends(get_db), _: str = Depends(require_login)) -> AppSettingsOut:
    return _app_settings_out(db)


@app.patch("/api/settings", response_model=AppSettingsOut)
def patch_app_settings(
    body: AppSettingsIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> AppSettingsOut:
    if body.max_concurrent_downloads is not None:
        try:
            set_max_concurrent_downloads(db, body.max_concurrent_downloads)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.default_quality is not None:
        try:
            set_default_quality(db, body.default_quality)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.autostart is not None:
        set_autostart(db, body.autostart)
    if body.auto_remove_completed is not None:
        set_auto_remove_completed(db, body.auto_remove_completed)
    return _app_settings_out(db)


class ApiTokenOut(BaseModel):
    id: int
    label: str
    created_at: str


class ApiTokenCreateOut(ApiTokenOut):
    token: str


class ApiTokenIn(BaseModel):
    label: str


@app.get("/api/settings/api-tokens", response_model=list[ApiTokenOut])
def list_api_tokens(db: Session = Depends(get_db), _: str = Depends(require_login)) -> list[ApiTokenOut]:
    tokens = db.query(ApiToken).order_by(ApiToken.id).all()
    return [ApiTokenOut(id=t.id, label=t.label, created_at=t.created_at.isoformat()) for t in tokens]


@app.post("/api/settings/api-tokens", response_model=ApiTokenCreateOut)
def create_api_token(
    body: ApiTokenIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ApiTokenCreateOut:
    token, raw_token = api_tokens_service.create_token(db, body.label)
    return ApiTokenCreateOut(id=token.id, label=token.label, created_at=token.created_at.isoformat(), token=raw_token)


@app.delete("/api/settings/api-tokens/{token_id}")
def delete_api_token(
    token_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> dict:
    if not api_tokens_service.delete_token(db, token_id):
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    return {"status": "ok"}


# ALLE /api- und /ws-Routen sind oben registriert - Starlette prüft Routen
# in Registrierungsreihenfolge, darum kann dieser Catch-All-Mount für das
# gebaute Frontend erst jetzt, ganz am Ende, kommen. Im Dev-Betrieb (kein
# `npm run build` gelaufen) existiert der Ordner noch nicht - dann einfach
# nichts mounten, Vites eigener Dev-Server bedient das Frontend per Proxy.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
