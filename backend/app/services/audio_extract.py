import subprocess
from pathlib import Path


class AudioExtractionError(Exception):
    pass


def extract_audio_mp3(video_path: Path) -> Path:
    """Extrahiert die Tonspur einer schon heruntergeladenen Datei per ffmpeg
    als echte eigenständige .mp3-Datei, neben der Originaldatei abgelegt
    (gleicher Dateistamm, andere Endung) - die Originaldatei bleibt dabei
    unverändert erhalten, es entsteht eine zusätzliche Datei."""
    if not video_path.exists():
        raise AudioExtractionError("Datei nicht gefunden.")
    out_path = video_path.with_suffix(".mp3")
    if out_path == video_path:
        # Käme nur vor, wenn die Originaldatei schon .mp3 heißt - dann nicht
        # sich selbst überschreiben, sondern einen eigenen Namen wählen.
        out_path = video_path.with_name(video_path.stem + "_audio.mp3")
    proc = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vn",
            "-acodec", "libmp3lame",
            "-b:a", "192k",
            str(out_path),
        ],
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0 or not out_path.exists():
        detail = proc.stderr.decode("utf-8", errors="replace").strip()[-500:]
        raise AudioExtractionError(detail or "ffmpeg ist fehlgeschlagen.")
    return out_path
