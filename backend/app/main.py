import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session

from app.config import STATIC_DIR
from app.version import PULLHAFEN_VERSION
from app.database import SessionLocal, get_db
from app.models import ApiToken, Item, Performer, RestrictedDomain, SiteCookie, Tag
from app.services import api_tokens as api_tokens_service
from app.services import audio_extract as audio_extract_service
from app.services import thumbnails as thumbnails_service
from app.services.auth import (
    LastAccountError,
    PasswordTooLongError,
    SelfDeleteError,
    UsernameTakenError,
    WrongPasswordError,
    bootstrap_admin_if_needed,
    change_password,
    create_user,
    delete_user,
    get_or_create_session_secret,
    list_usernames,
    must_change_password as auth_must_change_password,
    pending_initial_login_username,
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Stufe 13: ein Container-Neustart (hart beendet, mitten im Download)
    # lässt Items mit status='downloading' in der DB zurück, aber OHNE
    # laufenden Task (die Task-Registry in download_manager ist In-Process-
    # Zustand, der den Neustart nicht überlebt). Ohne diese Reconciliation
    # blieben solche Items für immer auf 'downloading' stehen, ohne dass
    # irgendwas sie je wieder anfasst. SQLite ist die Quelle der Wahrheit
    # (siehe Plan) - beim echten Start auf 'paused' setzen (NICHT 'queued' -
    # run_generic_download erkennt ein Range-Resume nur bei status='paused'
    # UND vorhandenem file_path, siehe dort) und über dieselbe queue_*-Logik
    # wie ein manuelles Fortsetzen neu einreihen. Für die http-Engine liest
    # download_to_directory die tatsächliche Dateigröße auf Platte (nicht
    # den zuletzt committeten DB-Wert) für den Resume - robust auch gegen
    # zuletzt ungeschriebene, gepufferte Bytes. Für yt-dlp findet continuedl
    # die eigene .part-Datei unabhängig vom DB-Status von selbst wieder.
    with SessionLocal() as db:
        orphaned = db.query(Item).filter(Item.status == "downloading").all()
        to_requeue = [(item.id, item.engine) for item in orphaned]
        for item in orphaned:
            item.status = "paused"
        db.commit()
    for item_id, engine in to_requeue:
        if engine == "http":
            dm.queue_generic_download(item_id)
        else:
            dm.queue_ytdlp_download(item_id)
    yield


app = FastAPI(title="Pullhafen", lifespan=lifespan)
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
    return {"username": body.username, "must_change_password": auth_must_change_password(db, body.username)}


@app.get("/api/auth/pending-initial-login")
def pending_initial_login(db: Session = Depends(get_db)) -> dict:
    """Ohne Login abrufbar - die Login-Seite fragt das vor jeder Anmeldung
    ab, um bei Bedarf "Passwort steht in den Installationslogs" anzuzeigen.
    Gibt nie ein Passwort zurück, nur ob/für wen das noch offen ist."""
    return {"pending_username": pending_initial_login_username(db)}


@app.post("/api/auth/logout")
def logout(request: Request) -> dict:
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(username: str = Depends(require_login), db: Session = Depends(get_db)) -> dict:
    return {"username": username, "must_change_password": auth_must_change_password(db, username)}


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/change-password")
def change_password_endpoint(
    body: ChangePasswordIn,
    db: Session = Depends(get_db),
    username: str = Depends(require_login),
) -> dict:
    try:
        change_password(db, username, body.current_password, body.new_password)
    except WrongPasswordError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PasswordTooLongError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


class VerifyPasswordIn(BaseModel):
    password: str


@app.post("/api/auth/verify-password")
def verify_password_endpoint(
    body: VerifyPasswordIn, db: Session = Depends(get_db), username: str = Depends(require_login)
) -> dict:
    """Bestätigt das eigene Passwort der schon eingeloggten Person, ohne
    sonst etwas zu verändern - fürs Frontend, wenn eine Aktion (z.B.
    eingeschränkte Inhalte im Bibliotheks-Filter sichtbar machen) erst nach
    einer echten Passwortbestätigung erlaubt sein soll, nicht nur per Klick."""
    return {"valid": verify_login(db, username, body.password)}


class UserOut(BaseModel):
    username: str


@app.get("/api/auth/users", response_model=list[UserOut])
def list_users_endpoint(db: Session = Depends(get_db), _: str = Depends(require_login)) -> list[UserOut]:
    return [UserOut(username=u) for u in list_usernames(db)]


class CreateUserIn(BaseModel):
    current_password: str
    new_username: str
    new_password: str


@app.post("/api/auth/users", response_model=UserOut)
def create_user_endpoint(
    body: CreateUserIn, db: Session = Depends(get_db), username: str = Depends(require_login)
) -> UserOut:
    try:
        create_user(db, username, body.current_password, body.new_username, body.new_password)
    except WrongPasswordError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except (UsernameTakenError, PasswordTooLongError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UserOut(username=body.new_username.strip())


class DeleteUserIn(BaseModel):
    current_password: str


@app.delete("/api/auth/users/{target_username}")
def delete_user_endpoint(
    target_username: str,
    body: DeleteUserIn,
    db: Session = Depends(get_db),
    username: str = Depends(require_login),
) -> dict:
    try:
        delete_user(db, username, body.current_password, target_username)
    except WrongPasswordError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except (SelfDeleteError, LastAccountError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


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
    # Nur von der Browser-Extension genutzt (siehe background.js) - wenn sie
    # beim Senden schon Cookies für die Ziel-Domain mitschickt, muss die
    # Seite nicht erst scheitern, bevor man die Zugangsdaten nachträgt.
    cookies: str | None = None


# Reine Texterkennung auf der Fehlermeldung - keine Garantie, nur ein
# brauchbarer Hinweis für den häufigsten Fall (Login/Altersbestätigung
# per Cookie). Bewusst eine flache Liste von Teilstrings statt irgendeiner
# Klassifizierungs-Logik, leicht erweiterbar, wenn ein echter Fall auftaucht,
# den das hier noch nicht erkennt.
_NEEDS_COOKIES_HINTS = (
    "sign in",
    "log in",
    "anmelden",
    "einloggen",
    "cookies",
    "age-restricted",
    "age restricted",
    "confirm your age",
    "altersbestätigung",
    "private video",
    "members only",
    "members-only",
    "subscriber",
    "registrier",
)


def _needs_cookies(error_message: str | None) -> bool:
    if not error_message:
        return False
    lowered = error_message.lower()
    return any(hint in lowered for hint in _NEEDS_COOKIES_HINTS)


class ItemOut(BaseModel):
    id: int
    url: str
    engine: str
    status: str
    filename: str | None
    file_path: str | None
    audio_path: str | None
    quality_preset: str | None
    bytes_downloaded: int
    total_bytes: int | None
    error_message: str | None
    source: str | None
    age_limit: int
    duration_seconds: int | None
    title: str | None
    channel: str | None
    tags: list[str]
    performers: list[str]
    restricted_override: bool | None
    restricted: bool
    hidden_from_downloads: bool
    created_at: str
    # Nur beim Hinzufügen eines Links relevant (siehe _create_link_item) -
    # True heißt: dieser Link existierte schon, es wurde NICHTS neu angelegt,
    # das zurückgegebene Item ist der bereits vorhandene Eintrag.
    already_existed: bool = False
    # Ob für diese URL schon ein Cookie-String hinterlegt ist (der Wert
    # selbst geht nie ans Frontend - einmal gesetzt, bleibt er geheim,
    # genau wie ein Passwort).
    has_cookies: bool = False
    # Reine Texterkennung auf error_message (siehe _needs_cookies) - zeigt
    # dem Frontend an, wann sich das Cookie-Eingabefeld statt nur der
    # rohen Fehlermeldung anbietet.
    needs_cookies: bool = False

    @classmethod
    def from_item(
        cls,
        item: Item,
        restricted_domains: set[str],
        age_limit_threshold: int,
        already_existed: bool = False,
    ) -> "ItemOut":
        return cls(
            id=item.id,
            url=item.url,
            engine=item.engine,
            status=item.status,
            filename=item.filename,
            file_path=item.file_path,
            audio_path=item.audio_path,
            quality_preset=item.quality_preset,
            bytes_downloaded=item.bytes_downloaded,
            total_bytes=item.total_bytes,
            error_message=item.error_message,
            source=item.source,
            age_limit=item.age_limit,
            duration_seconds=item.duration_seconds,
            title=item.title,
            channel=item.channel,
            created_at=item.created_at.isoformat(),
            tags=sorted(tag.name for tag in item.tags),
            performers=sorted(performer.name for performer in item.performers),
            restricted_override=item.restricted_override,
            restricted=restricted_service.is_restricted(
                item, restricted_domains, age_limit_threshold
            ),
            hidden_from_downloads=item.hidden_from_downloads,
            already_existed=already_existed,
            has_cookies=bool(item.cookies),
            needs_cookies=_needs_cookies(item.error_message),
        )


def _restricted_context(db: Session) -> tuple[set[str], int]:
    return (
        restricted_service.restricted_domains_set(db),
        restricted_service.get_age_limit_threshold(db),
    )


_DEFAULT_PORTS = {"http": 80, "https": 443}


def _same_host_and_port(url: str, own_host: str) -> bool:
    """Hostname ALLEIN reicht nicht - 127.0.0.1:8899 (ein anderer Dienst auf
    derselben Maschine/IP) ist ein echter Fund gewesen, der sonst fälschlich
    als 'Pullhafen selbst' blockiert worden wäre. Vergleicht darum Host UND
    Port, mit dem schemaspezifischen Standardport, wenn keiner angegeben
    ist (http -> 80, https -> 443)."""
    a, b = urlsplit(url), urlsplit(own_host)
    if a.hostname != b.hostname:
        return False
    port_a = a.port or _DEFAULT_PORTS.get(a.scheme)
    port_b = b.port or _DEFAULT_PORTS.get(b.scheme)
    return port_a == port_b


def _get_site_cookies(db: Session, url: str) -> str | None:
    domain = urlsplit(url).hostname
    if not domain:
        return None
    row = db.get(SiteCookie, domain)
    return row.cookies if row is not None else None


def _set_site_cookies(db: Session, url: str, cookies: str) -> None:
    domain = urlsplit(url).hostname
    if not domain:
        return
    row = db.get(SiteCookie, domain)
    if row is None:
        db.add(SiteCookie(domain=domain, cookies=cookies))
    else:
        row.cookies = cookies
    db.commit()


async def _create_link_item(
    url: str, db: Session, own_host: str | None = None, cookies: str | None = None
) -> ItemOut:
    """Gemeinsame Logik für /api/links (Session-Auth) und
    /api/extension/links (Bearer-Token) - derselbe Trockenlauf, dieselbe
    Engine-Entscheidung, derselbe WS-Broadcast, nur der Auth-Pfad
    unterscheidet sich zwischen den beiden Endpunkten."""
    # Pullhafen kann sich sonst selbst als Download-Ziel eintragen, wenn
    # man versehentlich die eigene Adresse einfügt (real passiert) - der
    # generische Downloader würde dann einfach die eigene Login-/
    # Dashboard-Seite als Datei herunterladen, statt einen Fehler zu zeigen.
    if own_host is not None and _same_host_and_port(url, own_host):
        raise HTTPException(
            status_code=400,
            detail="Das ist die Adresse von Pullhafen selbst - die lässt sich nicht als Download hinzufügen.",
        )
    # Exakt dieselbe URL schon vorhanden (egal welcher Status) - nicht
    # nochmal klassifizieren/anlegen, sondern den bestehenden Eintrag mit
    # already_existed=True zurückgeben, damit das Frontend "schon vorhanden"
    # statt eines stillen Duplikats anzeigen kann.
    existing = db.query(Item).filter(Item.url == url).first()
    if existing is not None:
        domains, threshold = _restricted_context(db)
        return ItemOut.from_item(existing, domains, threshold, already_existed=True)

    # Kein explizit mitgegebener Cookie (z.B. von der Extension) -> schauen,
    # ob für diese Domain schon einmal einer hinterlegt wurde (siehe
    # /api/items/{id}/cookies). So braucht jedes weitere Video von einer
    # schon bekannten Seite den Cookie nicht erneut von Hand.
    if cookies is None:
        cookies = _get_site_cookies(db, url)

    # Echter yt-dlp-Trockenlauf entscheidet: erkanntes Video -> ytdlp-Engine,
    # keine Seite zuständig -> generischer httpx-Download, bekannte Seite
    # aber Video kaputt -> klar als gescheiterter Video-Download melden
    # (nicht als generischer Download der Fehlerseite durchrutschen lassen).
    try:
        # classify() hat selbst schon knappe Retry-/Timeout-Werte (siehe
        # dort) - dieses äußere Limit ist nur das Rückfallnetz, falls yt-dlp
        # trotzdem mal länger hängt (echt beobachtet: eine von YouTube
        # ratenlimitierte Session ließ eine einzelne Anfrage >13 Minuten
        # laufen, mit einem ausgegrauten Button und ohne jede Rückmeldung).
        info = await asyncio.wait_for(asyncio.to_thread(ytdlp_engine.classify, url, cookies), timeout=30)
    except asyncio.TimeoutError:
        item = Item(
            url=url,
            engine="ytdlp",
            status="failed",
            error_message="Zeitüberschreitung beim Prüfen des Links (z.B. durch Ratenlimit der Seite) - bitte später erneut versuchen.",
            cookies=cookies,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        domains, threshold = _restricted_context(db)
        out = ItemOut.from_item(item, domains, threshold)
        await ws_manager.broadcast({"type": "item_update", "item": out.model_dump()})
        return out
    except ytdlp_engine.VideoUnavailableError as exc:
        item = Item(url=url, engine="ytdlp", status="failed", error_message=str(exc), cookies=cookies)
        db.add(item)
        db.commit()
        db.refresh(item)
        domains, threshold = _restricted_context(db)
        out = ItemOut.from_item(item, domains, threshold)
        await ws_manager.broadcast({"type": "item_update", "item": out.model_dump()})
        return out

    autostart = get_autostart(db)
    if info is not None:
        duration = info.get("duration")
        item = Item(
            url=url,
            engine="ytdlp",
            status="queued",
            source=info.get("extractor_key"),
            age_limit=info.get("age_limit") or 0,
            duration_seconds=round(duration) if isinstance(duration, (int, float)) else None,
            title=info.get("title"),
            channel=info.get("channel") or info.get("uploader"),
            cookies=cookies,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        # Echte, von der Seite selbst vergebene Video-Tags (z.B. YouTubes
        # eigene Tags) automatisch übernehmen - auf 10 begrenzt, manche
        # Videos haben davon sehr viele und nicht jedes ist hilfreich.
        # "Darsteller:innen" hat dagegen kein verlässliches, seitenübergreifendes
        # Äquivalent bei yt-dlp - bewusst nicht erfunden, bleibt manuell.
        site_tags = info.get("tags")
        if isinstance(site_tags, list) and site_tags:
            names = {str(t).strip() for t in site_tags[:10] if str(t).strip()}
            item.tags = [_get_or_create(db, Tag, name) for name in sorted(names)]
            db.commit()
        if autostart:
            dm.queue_ytdlp_download(item.id)
    else:
        item = Item(url=url, engine="http", status="queued", cookies=cookies)
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
    body: LinkIn, request: Request, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ItemOut:
    return await _create_link_item(body.url, db, own_host=str(request.base_url), cookies=body.cookies)


@app.post("/api/extension/links", response_model=ItemOut)
async def add_extension_link(
    body: LinkIn, request: Request, db: Session = Depends(get_db), _: ApiToken = Depends(require_api_token)
) -> ItemOut:
    return await _create_link_item(body.url, db, own_host=str(request.base_url), cookies=body.cookies)


@app.get("/api/items/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    domains, threshold = _restricted_context(db)
    return ItemOut.from_item(item, domains, threshold)


@app.get("/api/items/{item_id}/thumbnail")
def get_item_thumbnail(
    item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> FileResponse:
    """Extrahiert on-demand das eingebettete Vorschaubild (siehe Stufe 7:
    yt-dlps EmbedThumbnail-Postprocessor) und cacht es - nur yt-dlp-Items
    haben eins, generische Dateien liefern bewusst 404, das Frontend zeigt
    dann ein generisches Icon statt eines kaputten Bild-Tags."""
    item = db.get(Item, item_id)
    if item is None or item.engine != "ytdlp" or not item.file_path:
        raise HTTPException(status_code=404, detail="Kein Vorschaubild verfügbar.")
    video_path = Path(item.file_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    thumb = thumbnails_service.extract_thumbnail(item.id, video_path)
    if thumb is None:
        raise HTTPException(status_code=404, detail="Kein Vorschaubild verfügbar.")
    return FileResponse(thumb)


@app.get("/api/items/{item_id}/stream")
def stream_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> FileResponse:
    """Für den Browser-Player in der Bibliothek - Starlettes FileResponse
    unterstützt Range-Requests schon eingebaut (fürs Vor-/Zurückspulen),
    kein eigener Code dafür nötig."""
    item = db.get(Item, item_id)
    if item is None or not item.file_path:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    path = Path(item.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    return FileResponse(path, filename=item.filename or path.name)


@app.post("/api/items/{item_id}/convert-audio", response_model=ItemOut)
async def convert_audio(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> ItemOut:
    """Extrahiert die Tonspur eines schon abgeschlossenen Downloads als
    echte .mp3-Datei (siehe app.services.audio_extract) - läuft in einem
    Worker-Thread, damit der ffmpeg-Aufruf den Event-Loop nicht blockiert,
    genau wie der yt-dlp-Trockenlauf beim Hinzufügen eines Links."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status != "completed" or not item.file_path:
        raise HTTPException(status_code=400, detail="Nur abgeschlossene Downloads lassen sich umwandeln.")
    video_path = Path(item.file_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    try:
        audio_path = await asyncio.to_thread(audio_extract_service.extract_audio_mp3, video_path)
    except audio_extract_service.AudioExtractionError as exc:
        raise HTTPException(status_code=500, detail=f"Umwandlung fehlgeschlagen: {exc}") from exc
    item.audio_path = str(audio_path)
    db.commit()
    db.refresh(item)
    domains, threshold = _restricted_context(db)
    out = ItemOut.from_item(item, domains, threshold)
    await ws_manager.broadcast({"type": "item_update", "item": out.model_dump()})
    return out


@app.get("/api/items/{item_id}/audio")
def stream_item_audio(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> FileResponse:
    item = db.get(Item, item_id)
    if item is None or not item.audio_path:
        raise HTTPException(status_code=404, detail="Keine Audiodatei vorhanden.")
    path = Path(item.audio_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    return FileResponse(path, filename=path.name)


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


class ItemCookiesIn(BaseModel):
    cookies: str


@app.post("/api/items/{item_id}/cookies", response_model=ItemOut)
async def set_item_cookies_and_retry(
    item_id: int, body: ItemCookiesIn, db: Session = Depends(get_db), _: str = Depends(require_login)
) -> ItemOut:
    """Für den Fall, dass eine Seite nur eine Login-/Altersbestätigung per
    Cookie braucht (siehe needs_cookies in ItemOut): speichert den
    eingegebenen Cookie-String am Item und startet denselben Download
    sofort neu damit - derselbe Mechanismus wie /restart, nur mit dem
    zusätzlichen Schritt davor. Merkt sich den Cookie zusätzlich pro Domain
    (siehe _set_site_cookies), damit jedes künftige Video von derselben
    Seite ihn automatisch von Anfang an mitbekommt."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if item.status not in ("paused", "failed", "completed"):
        raise HTTPException(status_code=400, detail="Dieser Status kann nicht neu gestartet werden.")
    if dm.is_active(item.id):
        raise HTTPException(status_code=409, detail="Download läuft gerade - zuerst pausieren.")
    item.cookies = body.cookies
    item.hidden_from_downloads = False
    db.commit()
    _set_site_cookies(db, item.url, body.cookies)
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


@app.delete("/api/items/{item_id}")
async def delete_item(item_id: int, db: Session = Depends(get_db), _: str = Depends(require_login)) -> dict:
    """Entfernt einen Eintrag komplett - aus der Warteschlange/Downloads
    genauso wie aus der Bibliothek (ein 'completed' Item löscht hier
    tatsächlich die fertige Datei, nicht nur eine Teildatei; das Frontend
    fragt vorher per Bestätigungsdialog nach, siehe Library.tsx). Nur
    erlaubt, wenn gerade kein Task läuft (sonst zuerst pausieren). Der
    Datenbankeintrag wird hart gelöscht (nicht nur als 'gelöscht' markiert),
    damit der Duplikat-Check in _create_link_item beim erneuten Einfügen
    derselben URL die echten Daten als wirklich weg erkennt, statt sie
    fälschlich als 'schon vorhanden' zu melden."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if dm.is_active(item.id):
        raise HTTPException(status_code=409, detail="Download läuft gerade - zuerst pausieren.")
    if item.file_path:
        real_file = Path(item.file_path)
        if real_file.exists():
            real_file.unlink()
    if item.audio_path:
        audio_file = Path(item.audio_path)
        if audio_file.exists():
            audio_file.unlink()
    cached_thumbnail = thumbnails_service.thumbnail_path_for(item_id)
    if cached_thumbnail is not None:
        cached_thumbnail.unlink()
    db.delete(item)
    db.commit()
    await ws_manager.broadcast({"type": "item_removed", "id": item_id})
    return {"status": "ok"}


@app.post("/api/downloads/cleanup")
def cleanup_downloads(db: Session = Depends(get_db), _: str = Depends(require_login)) -> dict:
    """Blendet abgeschlossene/fehlgeschlagene Downloads aus dem Downloads-
    Reiter aus (die Bibliothek bleibt unberührt, siehe Item.hidden_from_downloads).
    'completed' landet im neuen Reiter-Modell ohnehin in der Bibliothek, nicht
    mehr in Downloads - diese Filterung bleibt trotzdem bestehen, falls
    hidden_from_downloads künftig auch anderswo gelesen wird."""
    count = (
        db.query(Item)
        .filter(
            Item.status.in_(("completed", "failed")),
            Item.hidden_from_downloads == False,  # noqa: E712
        )
        .update({Item.hidden_from_downloads: True}, synchronize_session=False)
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
    version: str


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
        version=PULLHAFEN_VERSION,
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


class ExtensionPairIn(BaseModel):
    username: str
    password: str
    label: str = "Browser-Extension"


@app.post("/api/extension/pair", response_model=ApiTokenCreateOut)
def pair_extension(body: ExtensionPairIn, db: Session = Depends(get_db)) -> ApiTokenCreateOut:
    """Eigener, ohne Session erreichbarer Endpunkt für die Erweiterungs-
    Optionsseite: statt erst in den Einstellungen manuell einen Token zu
    erzeugen und ihn dann in die Erweiterung zu kopieren, gibt man dort
    einmal den normalen Benutzernamen/Passwort ein - derselbe Login-Check
    wie /api/auth/login, nur dass hier direkt ein Token zurückkommt statt
    einer Session."""
    if not verify_login(db, body.username, body.password):
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch.")
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
