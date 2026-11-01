import asyncio

from app.database import SessionLocal
from app.models import Item
from app.services.engines.http_engine import domain_folder, download_to_directory
from app.services.engines import ytdlp_engine
from app.services.settings import resolve_downloads_root
from app.services.ws_manager import manager


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
    }


async def _broadcast_item(item: Item) -> None:
    await manager.broadcast({"type": "item_update", "item": _item_snapshot(item)})


async def run_generic_download(item_id: int) -> None:
    """Läuft als eigene asyncio-Task, mit ihrer eigenen DB-Session (die
    Request-Session ist längst zu, wenn das hier tatsächlich lädt)."""
    db = SessionLocal()
    try:
        item = db.get(Item, item_id)
        if item is None:
            return
        item.status = "downloading"
        db.commit()
        await _broadcast_item(item)

        root = resolve_downloads_root(db)
        target_dir = root / domain_folder(item.url)

        async def on_progress(downloaded: int, total: int | None) -> None:
            item.bytes_downloaded = downloaded
            item.total_bytes = total
            db.commit()
            await _broadcast_item(item)

        try:
            result = await download_to_directory(item.url, target_dir, progress_cb=on_progress)
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
        db.close()


async def run_ytdlp_download(item_id: int) -> None:
    db = SessionLocal()
    try:
        item = db.get(Item, item_id)
        if item is None:
            return
        item.status = "downloading"
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
            # Läuft im Worker-Thread von asyncio.to_thread (download_sync),
            # nicht auf dem Event-Loop - die DB-Session wird trotzdem sicher
            # wiederverwendet (derselbe Thread, keine Nebenläufigkeit auf
            # ihr), aber der Broadcast MUSS über den echten Loop laufen.
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
                ytdlp_engine.download_sync, item.url, target_dir, progress_hook
            )
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
        db.close()
