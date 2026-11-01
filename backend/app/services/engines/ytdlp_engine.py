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
    return {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        # Echter, ernster Fund: ohne das lädt yt-dlp bei einem Link mit
        # einem list=-Parameter (YouTube-Mix/Radio/Playlist) die GESAMTE
        # Playlist als einen einzigen Download herunter - bei Thomas real
        # ~15GB über 100+ Einzelvideos, bis YouTube es irgendwann mit einem
        # 503 gestoppt hat. Pullhafen ist als "eine URL = ein Item" gebaut,
        # darum hier hart auf das einzelne verlinkte Video beschränkt.
        "noplaylist": True,
    }


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
    opts = {
        **_base_opts(),
        "skip_download": True,
        # Echter Fund: ohne das kann ein einzelner problematischer Link
        # (z.B. eine von YouTube ratenlimitierte Session bei einem Mix-/
        # Radio-Link) yt-dlps eigene Retry-Logik viele Minuten lang
        # beschäftigen, während /api/links auf eine Antwort wartet - ein
        # Nutzer sieht in der Zeit nur einen ausgegrauten Button ohne jede
        # Rückmeldung. Das ist hier nur der schnelle Trockenlauf zur
        # Klassifizierung, nicht der eigentliche Download - darum bewusst
        # knapp: lieber schnell "fehlgeschlagen" melden als lange hängen.
        "socket_timeout": 15,
        "retries": 1,
        "extractor_retries": 1,
        "fragment_retries": 1,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        raise VideoUnavailableError(str(exc)) from exc


class DownloadResult:
    def __init__(self, file_path: Path, filename: str):
        self.file_path = file_path
        self.filename = filename


def _delete_matching_files(url: str, target_dir: Path, outtmpl: str) -> None:
    """Für einen echten Restart: findet per Trockenlauf-Extraktion den
    Dateistamm, den yt-dlp für diese URL verwenden würde, und löscht alles
    mit diesem Stamm (fertige Datei, .part/.ytdl-Reste, Vorschaubild) -
    sonst würde `continuedl: False` zwar ein Resume verhindern, die alten
    Bytes aber trotzdem liegen lassen bzw. yt-dlp verwirren."""
    probe_opts = {**_base_opts(), "outtmpl": outtmpl, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stem = Path(ydl.prepare_filename(info)).stem
    except Exception:  # noqa: BLE001 — Trockenlauf-Fehler blockt den Restart-Versuch nicht
        return
    for candidate in target_dir.glob(f"{stem}.*"):
        candidate.unlink(missing_ok=True)


def download_sync(
    url: str,
    target_dir: Path,
    progress_hook: ProgressHook,
    *,
    force_restart: bool = False,
    format_selector: str = "bestvideo+bestaudio/best",
) -> DownloadResult:
    """Läuft blockierend (via asyncio.to_thread aus dem Aufrufer). Echte
    Metadaten/Vorschaubild-Postprocessors, daher wird ffmpeg gebraucht —
    im Docker-Image (siehe Plan) immer vorhanden.

    Pause (Stufe 6) läuft NICHT über Task-Cancellation (der eigentliche
    Download läuft in einem Worker-Thread, den asyncio nicht stoppen kann) —
    stattdessen wirft `progress_hook` selbst `yt_dlp.utils.DownloadCancelled`,
    was yt-dlp als sauberen Abbruch behandelt und die bereits geschriebene
    `.part`-Datei stehen lässt. Resume ist dann einfach derselbe Aufruf noch
    einmal - yt-dlps eigenes `continuedl` (Default: an) findet die `.part`-
    Datei über denselben `outtmpl`-Pfad automatisch wieder."""
    target_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(target_dir / "%(title)s.%(ext)s")
    if force_restart:
        _delete_matching_files(url, target_dir, outtmpl)
    opts = {
        **_base_opts(),
        "outtmpl": outtmpl,
        "format": format_selector,
        "merge_output_format": "mkv",
        "progress_hooks": [progress_hook],
        "postprocessors": [
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ],
        "writethumbnail": True,
    }
    if force_restart:
        opts["continuedl"] = False
        opts["overwrites"] = True
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    # info['requested_downloads'][0]['filepath'] ist der echte Endpfad NACH
    # Merge/Remux - ydl.prepare_filename() kennt diese Nacharbeit nicht und
    # würde den ursprünglichen (falschen) Containernamen liefern.
    resolved = info.get("requested_downloads")
    final_path = Path(resolved[0]["filepath"]) if resolved else Path(ydl.prepare_filename(info))
    return DownloadResult(file_path=final_path, filename=final_path.name)
