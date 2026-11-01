from fastapi import FastAPI

app = FastAPI(title="Pullhafen")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
