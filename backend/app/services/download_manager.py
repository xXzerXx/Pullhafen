import asyncio
import threading
from pathlib import Path

from yt_dlp.utils import DownloadCancelled

from app.database import SessionLocal
from app.models import Item
from app.services.engines.http_engine import domain_folder, download_to_directory
from app.services.engines import ytdlp_engine
from app.services.settings import resolve_downloads_root
from app.services.ws_manager import manager

# Pro aktivem Download: der asyncio.Task selbst (zum Abbrechen bei der
# http-Engine, die wirklich async läuft) UND - nur für yt-dlp, dessen
# eigentliche Arbeit blockierend in einem Worker-Thread läuft, wo
# task.cancel() den Thread nicht stoppt - ein threading.Event, das der
# progress_hook zwischen Chunks selbst abfragt und dann per
# DownloadCancelled abbricht.
_tasks: dict[int, asyncio.Task] = {}
_ytdlp_cancel_events: dict[int, threading.Event] = {}


def _item_snapshot(item: Item) -> dict:
    return {
        "id": item.id,
        "url": item.url,
        "engine": item.engine,
        "status": item.status,
        "filename": item.filename,
        "file_path": item.file_path,
        "bytes_downloaded": item.bytes_downloaded,
        "total_bytes": item.total_bytes,
        "error_message": item.error_message,
        "source": item.source,
        "age_limit": item.age_limit,
        "tags": sorted(tag.name for tag in item.tags),
        "performers": sorted(performer.name for performer in item.performers),
    }


async def _broadcast_item(item: Item) -> None:
    await manager.broadcast({"type": "item_update", "item": _item_snapshot(item)})


def is_active(item_id: int) -> bool:
    return item_id in _tasks


def pause_item(item_id: int) -> bool:
    """Best-effort: True, wenn ein aktiver Download zum Abbrechen gefunden
    wurde (die tatsächliche Statusänderung auf 'paused' passiert async im
    Task selbst und wird per WebSocket gemeldet, nicht hier synchron)."""
    event = _ytdlp_cancel_events.get(item_id)
    if event is not None:
        event.set()
        return True
    task = _tasks.get(item_id)
    if task is not None:
        task.cancel()
        return True
    return False


def queue_generic_download(item_id: int, *, restart: bool = False) -> None:
    task = asyncio.create_task(run_generic_download(item_id, restart=restart))
    _tasks[item_id] = task


def queue_ytdlp_download(item_id: int, *, restart: bool = False) -> None:
    task = asyncio.create_task(run_ytdlp_download(item_id, restart=restart))
    _tasks[item_id] = task


async def run_generic_download(item_id: int, *, restart: bool = False) -> None:
    """Läuft als eigene asyncio-Task, mit ihrer eigenen DB-Session (die
    Request-Session ist längst zu, wenn das hier tatsächlich lädt).

    Entscheidet selbst anhand des Item-Zustands, ob es sich um einen
    Erststart (kein file_path), ein Resume (status='paused' + file_path
    einer bestehenden Teildatei) oder - bei restart=True - einen bewussten
    Neustart von Null handelt."""
    db = SessionLocal()
    try:
        item = db.get(Item, item_id)
        if item is None:
            return

        resume_from = 0
        dest_path: Path | None = None

        if restart:
            if item.file_path:
                old = Path(item.file_path)
                if old.exists():
                    old.unlink()
            item.file_path = None
            item.filename = None
            item.bytes_downloaded = 0
            item.total_bytes = None
        elif item.status == "paused" and item.file_path:
            candidate = Path(item.file_path)
            if candidate.exists():
                dest_path = candidate
                resume_from = candidate.stat().st_size
                item.bytes_downloaded = resume_from

        item.status = "downloading"
        item.error_message = None
        db.commit()
        await _broadcast_item(item)

        root = resolve_downloads_root(db)
        target_dir = root / domain_folder(item.url)

        async def on_start(path: Path, total: int | None) -> None:
            item.file_path = str(path)
            item.filename = path.name
            item.total_bytes = total
            db.commit()
            await _broadcast_item(item)

        async def on_progress(downloaded: int, total: int | None) -> None:
            item.bytes_downloaded = downloaded
            item.total_bytes = total
            db.commit()
            await _broadcast_item(item)

        try:
            result = await download_to_directory(
                item.url,
                target_dir,
                dest_path=dest_path,
                resume_from=resume_from,
                on_start=on_start,
                progress_cb=on_progress,
            )
        except asyncio.CancelledError:
            item.status = "paused"
            db.commit()
            await _broadcast_item(item)
            raise
        except Exception as exc:  # noqa: BLE001 — echte Downloadfehler landen im Item, nicht als 500 irgendwo
            item.status = "failed"
            item.error_message = str(exc)
            db.commit()
            await _broadcast_item(item)
            return

        item.status = "completed"
        item.filename = result.filename
        item.file_path = str(result.file_path)
        item.bytes_downloaded = result.bytes_downloaded
        db.commit()
        await _broadcast_item(item)
    finally:
        _tasks.pop(item_id, None)
        db.close()


async def run_ytdlp_download(item_id: int, *, restart: bool = False) -> None:
    db = SessionLocal()
    cancel_event = threading.Event()
    _ytdlp_cancel_events[item_id] = cancel_event
    try:
        item = db.get(Item, item_id)
        if item is None:
            return

        if restart:
            item.bytes_downloaded = 0
            item.total_bytes = None

        item.status = "downloading"
        item.error_message = None
        db.commit()
        await _broadcast_item(item)

        root = resolve_downloads_root(db)
        target_dir = root / (item.source or "Unbekannt")
        loop = asyncio.get_running_loop()

        # bestvideo+bestaudio lädt zwei getrennte Formate (Video, dann Audio)
        # VOR dem Mergen - yt-dlps Hook meldet pro Aufruf nur das jeweils
        # aktuelle Format. Ohne diese beiden Zähler würde bytes_downloaded
        # beim Wechsel aufs zweite Format zurückspringen (Stufe-4-Lücke).
        completed_bytes = 0
        completed_total = 0

        def progress_hook(d: dict) -> None:
            nonlocal completed_bytes, completed_total
            # Läuft im Worker-Thread von asyncio.to_thread (download_sync) -
            # task.cancel() von außen würde diesen Thread nicht stoppen,
            # darum prüft der Hook das Event selbst und bricht per
            # DownloadCancelled ab (das fängt yt-dlp sauber, lässt die
            # .part-Datei stehen - Resume ist dann einfach derselbe Aufruf
            # noch einmal, siehe download_sync-Docstring).
            if cancel_event.is_set():
                raise DownloadCancelled("Pausiert.")
            status = d.get("status")
            if status == "downloading":
                current = d.get("downloaded_bytes") or 0
                current_total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                item.bytes_downloaded = completed_bytes + current
                item.total_bytes = (completed_total + current_total) or None
                db.commit()
                # Snapshot HIER bauen, noch im selben (Worker-)Thread, der
                # auch committet hat - eine SQLAlchemy-Session ist nicht
                # threadsicher. Der Event-Loop-Thread bekommt nur noch ein
                # fertiges dict, rührt das ORM-Objekt selbst nie an (sonst
                # intermittierende None-Werte durch gleichzeitigen Zugriff).
                snapshot = _item_snapshot(item)
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({"type": "item_update", "item": snapshot}), loop
                )
            elif status == "finished":
                completed_bytes += d.get("downloaded_bytes") or 0
                completed_total += d.get("total_bytes") or d.get("downloaded_bytes") or 0

        try:
            result = await asyncio.to_thread(
                ytdlp_engine.download_sync,
                item.url,
                target_dir,
                progress_hook,
                force_restart=restart,
            )
        except asyncio.CancelledError:
            item.status = "paused"
            db.commit()
            await _broadcast_item(item)
            raise
        except DownloadCancelled:
            item.status = "paused"
            db.commit()
            await _broadcast_item(item)
            return
        except Exception as exc:  # noqa: BLE001 — echte Downloadfehler landen im Item
            item.status = "failed"
            item.error_message = str(exc)
            db.commit()
            await _broadcast_item(item)
            return

        item.status = "completed"
        item.filename = result.filename
        item.file_path = str(result.file_path)
        db.commit()
        await _broadcast_item(item)
    finally:
        _ytdlp_cancel_events.pop(item_id, None)
        _tasks.pop(item_id, None)
        db.close()
