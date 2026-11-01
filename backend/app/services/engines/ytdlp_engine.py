from pathlib import Path
from typing import Callable

import yt_dlp
from yt_dlp.extractor import gen_extractor_classes

ProgressHook = Callable[[dict], None]


class VideoUnavailableError(Exception):
    """URL gehört erkennbar zu einer bestimmten Video-Seite, aber die
    Extraktion ist gescheitert (z.B. Video gelöscht/privat) - das ist ein
    gescheiterter Video-Download, kein generischer Datei-Download."""


def _base_opts() -> dict:
    return {"quiet": True, "no_warnings": True, "noprogress": True}


def _matches_specific_extractor(url: str) -> bool:
    """Rein offline: passt irgendein site-spezifischer Extractor (nicht der
    generische Catch-All) zur URL? Entscheidet, ob ein Extraktionsfehler
    'kein Video' bedeutet (-> http) oder 'DIESES Video ist kaputt' (-> failed)."""
    for ie in gen_extractor_classes():
        if getattr(ie, "IE_NAME", "") == "generic":
            continue
        try:
            if ie.suitable(url):
                return True
        except Exception:  # noqa: BLE001 — eine kaputte suitable()-Regex blockt nicht die Erkennung
            continue
    return False


def classify(url: str) -> dict | None:
    """Gibt das Info-Dict zurück, wenn yt-dlp die URL als Video erkennt,
    None, wenn keine Seite zuständig ist (-> generischer httpx-Download),
    oder wirft VideoUnavailableError, wenn eine bekannte Video-Seite
    zuständig ist, die Extraktion aber scheitert.

    Wichtig: der generische Catch-All-Extractor (GenericIE) wird hier
    bewusst NIE versucht - er würde sonst jede beliebige herunterladbare
    Datei (ein .zip, ein Binary) fälschlich als 'Video' einstufen, weil er
    für Direktlinks einfach auf den Rohbytes landet. Nur wenn eine
    SPEZIFISCHE Video-Seite die URL erkennt, läuft überhaupt eine echte
    Extraktion."""
    if not _matches_specific_extractor(url):
        return None
    opts = {**_base_opts(), "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise VideoUnavailableError(str(exc)) from exc


class DownloadResult:
    def __init__(self, file_path: Path, filename: str):
        self.file_path = file_path
        self.filename = filename


def download_sync(url: str, target_dir: Path, progress_hook: ProgressHook) -> DownloadResult:
    """Läuft blockierend (via asyncio.to_thread aus dem Aufrufer). Echte
    Metadaten/Vorschaubild-Postprocessors, daher wird ffmpeg gebraucht —
    im Docker-Image (siehe Plan) immer vorhanden."""
    target_dir.mkdir(parents=True, exist_ok=True)
    opts = {
        **_base_opts(),
        "outtmpl": str(target_dir / "%(title)s.%(ext)s"),
        "format": "bestvideo+bestaudio/best",
        "merge_output_format": "mkv",
        "progress_hooks": [progress_hook],
        "postprocessors": [
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ],
        "writethumbnail": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    # info['requested_downloads'][0]['filepath'] ist der echte Endpfad NACH
    # Merge/Remux - ydl.prepare_filename() kennt diese Nacharbeit nicht und
    # würde den ursprünglichen (falschen) Containernamen liefern.
    resolved = info.get("requested_downloads")
    final_path = Path(resolved[0]["filepath"]) if resolved else Path(ydl.prepare_filename(info))
    return DownloadResult(file_path=final_path, filename=final_path.name)
