from email.message import Message
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import urlsplit

import httpx

ProgressCallback = Callable[[int, int | None], Awaitable[None]]

CHUNK_SIZE = 65536


def domain_folder(url: str) -> str:
    host = urlsplit(url).hostname
    return host or "unbekannt"


def filename_from_response(url: str, response: httpx.Response) -> str:
    content_disposition = response.headers.get("content-disposition")
    if content_disposition:
        msg = Message()
        msg["content-disposition"] = content_disposition
        filename = msg.get_filename()
        if filename:
            return filename
    name = Path(urlsplit(url).path).name
    return name or "download"


def unique_destination(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem, suffix = Path(filename).stem, Path(filename).suffix
    n = 1
    while True:
        candidate = directory / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
        n += 1


class DownloadResult:
    def __init__(self, file_path: Path, filename: str, bytes_downloaded: int):
        self.file_path = file_path
        self.filename = filename
        self.bytes_downloaded = bytes_downloaded


async def download_to_directory(
    url: str,
    directory: Path,
    *,
    dest_path: Path | None = None,
    resume_from: int = 0,
    progress_cb: ProgressCallback | None = None,
) -> DownloadResult:
    """Lädt `url` komplett herunter. Ohne `dest_path` wird ein neuer,
    kollisionsfreier Dateiname in `directory` gewählt (erster Download).
    Mit `dest_path` + `resume_from` > 0 wird eine bestehende Teildatei per
    Range-Header fortgesetzt (Pause/Resume, Stufe 6)."""
    headers = {}
    mode = "wb"
    if resume_from > 0 and dest_path is not None:
        headers["Range"] = f"bytes={resume_from}-"
        mode = "ab"

    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        async with client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()
            if dest_path is None:
                filename = filename_from_response(url, response)
                dest_path = unique_destination(directory, filename)
            else:
                filename = dest_path.name

            content_length = response.headers.get("content-length")
            total_bytes = int(content_length) + resume_from if content_length else None

            downloaded = resume_from
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, mode) as f:
                async for chunk in response.aiter_bytes(CHUNK_SIZE):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_cb is not None:
                        await progress_cb(downloaded, total_bytes)

    return DownloadResult(file_path=dest_path, filename=filename, bytes_downloaded=downloaded)
