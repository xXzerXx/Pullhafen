import asyncio

from fastapi import WebSocket


class ConnectionManager:
    """Einfacher In-Process-Broadcast - reicht für einen Single-Admin-
    Container (siehe Architektur-Notiz im Plan), kein Redis/Pub-Sub nötig."""

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            targets = list(self._connections)
        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 — eine tote Verbindung fliegt raus, bricht den Broadcast nicht ab
                await self.disconnect(websocket)


manager = ConnectionManager()
