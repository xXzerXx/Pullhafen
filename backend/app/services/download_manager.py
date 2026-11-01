from app.database import SessionLocal
from app.models import Item
from app.services.engines.http_engine import domain_folder, download_to_directory
from app.services.settings import resolve_downloads_root


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

        root = resolve_downloads_root(db)
        target_dir = root / domain_folder(item.url)

        async def on_progress(downloaded: int, total: int | None) -> None:
            item.bytes_downloaded = downloaded
            item.total_bytes = total
            db.commit()

        try:
            result = await download_to_directory(item.url, target_dir, progress_cb=on_progress)
        except Exception as exc:  # noqa: BLE001 — echte Downloadfehler landen im Item, nicht als 500 irgendwo
            item.status = "failed"
            item.error_message = str(exc)
            db.commit()
            return

        item.status = "completed"
        item.filename = result.filename
        item.file_path = str(result.file_path)
        item.bytes_downloaded = result.bytes_downloaded
        db.commit()
    finally:
        db.close()
