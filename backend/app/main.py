from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.settings import (
    DOWNLOADS_SUBPATH_KEY,
    InvalidSubpathError,
    get_setting,
    resolve_downloads_root,
    set_setting,
    validate_downloads_subpath,
)

app = FastAPI(title="Pullhafen")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


class DownloadsRootOut(BaseModel):
    subpath: str
    resolved_path: str


class DownloadsRootIn(BaseModel):
    subpath: str


@app.get("/api/settings/downloads-root", response_model=DownloadsRootOut)
def get_downloads_root(db: Session = Depends(get_db)) -> DownloadsRootOut:
    subpath = get_setting(db, DOWNLOADS_SUBPATH_KEY, "")
    return DownloadsRootOut(subpath=subpath, resolved_path=str(resolve_downloads_root(db)))


@app.put("/api/settings/downloads-root", response_model=DownloadsRootOut)
def set_downloads_root(body: DownloadsRootIn, db: Session = Depends(get_db)) -> DownloadsRootOut:
    try:
        clean = validate_downloads_subpath(body.subpath)
    except InvalidSubpathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    set_setting(db, DOWNLOADS_SUBPATH_KEY, clean)
    return DownloadsRootOut(subpath=clean, resolved_path=str(resolve_downloads_root(db)))
