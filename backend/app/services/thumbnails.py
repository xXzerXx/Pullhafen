import json
import subprocess
from pathlib import Path

from app.config import DATA_DIR

THUMBNAIL_CACHE_DIR = DATA_DIR / "thumbnail_cache"

_MIME_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_CODEC_EXTENSIONS = {"mjpeg": "jpg", "png": "png", "webp": "webp"}


def thumbnail_path_for(item_id: int) -> Path | None:
    for ext in ("jpg", "png", "webp"):
        candidate = THUMBNAIL_CACHE_DIR / f"{item_id}.{ext}"
        if candidate.exists():
            return candidate
    return None


def _find_thumbnail_stream(video_path: Path) -> tuple[int, str] | None:
    """(Stream-Index, Dateiendung) des eingebetteten Vorschaubilds - entweder
    ein echtes Attachment (yt-dlps EmbedThumbnail bei mkv-Containern, wo
    ffprobe KEIN codec_name liefert - die echte Bildart steckt nur in
    tags.mimetype, z.B. "image/webp") oder ein zusätzlicher Videostream mit
    disposition.attached_pic=1 (mp4, dort liefert ffprobe einen echten
    codec_name wie "png") - beide Fälle real in Stufe 7 mit ffprobe/ffmpeg
    verifiziert, der mkv-Mimetype-Fall erst hier beim echten Redesign-Test
    gefunden (Datei kam als .jpg/image-jpeg raus, war aber echtes WebP)."""
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(video_path)],
            capture_output=True,
            timeout=15,
            text=True,
        )
        data = json.loads(proc.stdout)
    except Exception:  # noqa: BLE001 — kaputtes/fehlendes ffprobe-Ergebnis heißt nur "kein Vorschaubild"
        return None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "attachment":
            mimetype = stream.get("tags", {}).get("mimetype", "")
            if mimetype.startswith("image/"):
                return stream["index"], _MIME_EXTENSIONS.get(mimetype, "jpg")
        if stream.get("codec_type") == "video" and stream.get("disposition", {}).get("attached_pic") == 1:
            codec_name = stream.get("codec_name", "")
            return stream["index"], _CODEC_EXTENSIONS.get(codec_name, "jpg")
    return None


def extract_thumbnail(item_id: int, video_path: Path) -> Path | None:
    """Extrahiert einmalig per ffmpeg und cacht das Ergebnis auf Platte -
    ffmpeg läuft so nur beim ersten Abruf pro Item, nicht bei jeder Anfrage."""
    cached = thumbnail_path_for(item_id)
    if cached is not None:
        return cached
    found = _find_thumbnail_stream(video_path)
    if found is None:
        return None
    stream_index, ext = found
    THUMBNAIL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = THUMBNAIL_CACHE_DIR / f"{item_id}.{ext}"

    # Erster Versuch: echtes Attachment (mkv) - -dump_attachment.
    try:
        subprocess.run(
            ["ffmpeg", "-y", f"-dump_attachment:{stream_index}", str(out_path), "-i", str(video_path)],
            capture_output=True,
            timeout=30,
        )
    except Exception:  # noqa: BLE001
        pass
    if out_path.exists():
        return out_path

    # Zweiter Versuch: eingebetteter Videostream mit attached_pic=1 (mp4).
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(video_path),
                "-map", f"0:{stream_index}", "-vframes", "1", "-vcodec", "copy",
                str(out_path),
            ],
            capture_output=True,
            timeout=30,
        )
    except Exception:  # noqa: BLE001
        return None
    return out_path if out_path.exists() else None
