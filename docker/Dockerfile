# syntax=docker/dockerfile:1

# --- Stage 1: Frontend bauen -------------------------------------------
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# vite.config.ts hat outDir auf '../backend/app/static' gesetzt - landet von
# hier aus unter /app/backend/app/static, die Stage 2 holt sich genau das.
RUN npm run build

# --- Stage 2: Backend + Laufzeit ----------------------------------------
FROM python:3.14-slim AS backend

# Verknüpft das gebaute Image mit dem Quell-Repo (GHCR zeigt es dann direkt
# auf der Repo-Seite unter "Packages" an, statt als loses, unverknüpftes
# Package zu erscheinen).
LABEL org.opencontainers.image.source="https://github.com/xXzerXx/Pullhafen"
LABEL org.opencontainers.image.description="Pullhafen - selbst gehosteter Download-Manager (yt-dlp + generische Downloads)"
LABEL org.opencontainers.image.licenses="NOASSERTION"

# ffmpeg wird von yt-dlps FFmpegMetadata/EmbedThumbnail-Postprocessors und
# fürs Mergen von bestvideo+bestaudio gebraucht (siehe Stufe 4/7) - sonst
# bewusst keine weitere Fremdsoftware im Image (mkvtoolnix o.ä. wurde nie
# gebraucht, da die geplante Datei-Metadaten-Tag-Funktion nie gebaut wurde -
# Tags/Darsteller:innen leben nur in der DB, siehe Stufe 8).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /app/backend/app/static ./app/static

ENV PULLHAFEN_DATA_DIR=/data
ENV PULLHAFEN_DOWNLOADS_DIR=/downloads

EXPOSE 8000

# Migrationen laufen bei jedem Start - idempotent (alembic macht nichts,
# wenn schon alles aktuell ist), so übersteht ein Update der Tabellen auch
# einen reinen Container-Neustart ohne manuellen Schritt.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
