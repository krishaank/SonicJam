from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import httpx
import logging
import asyncio
from functools import lru_cache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Sonic Jam Backend")

# -------------------------------
# CORS
# -------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------
# WebSocket Room Manager
# -------------------------------
class ConnectionManager:
    def __init__(self):
        self.rooms = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()

        if room_id not in self.rooms:
            self.rooms[room_id] = []

        self.rooms[room_id].append(websocket)
        logger.info(f"User joined room: {room_id}")

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.rooms:
            self.rooms[room_id].remove(websocket)

            if not self.rooms[room_id]:
                del self.rooms[room_id]

            logger.info(f"User left room: {room_id}")

    async def broadcast(self, room_id: str, message: str):
        if room_id in self.rooms:
            for connection in self.rooms[room_id]:
                await connection.send_text(message)

manager = ConnectionManager()

# -------------------------------
# YouTube Audio Extraction
# -------------------------------
@lru_cache(maxsize=32)
def get_audio_url(youtube_url: str) -> str:
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'youtube_include_dash_manifest': False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            return info['url']
    except Exception as e:
        logger.error(f"Error extracting audio URL: {e}")
        raise ValueError("Failed to extract audio URL from the provided link.")

# -------------------------------
# Stream API
# -------------------------------
@app.get("/api/stream")
async def stream_audio(url: str, request: Request):
    if not url:
        raise HTTPException(status_code=400, detail="Missing YouTube URL parameter")

    try:
        audio_stream_url = await asyncio.to_thread(get_audio_url, url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    client = httpx.AsyncClient(follow_redirects=True)

    headers = {}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]
        logger.info(f"Forwarding Range header: {headers['Range']}")

    try:
        logger.info(f"Proxying stream from URL: {audio_stream_url[:50]}...")
        req = client.build_request("GET", audio_stream_url, headers=headers)
        response = await client.send(req, stream=True)

        async def stream_generator():
            async for chunk in response.aiter_bytes():
                yield chunk
            await client.aclose()

        resp_headers = {}
        for key in ["content-type", "content-length", "accept-ranges", "content-range"]:
            if key in response.headers:
                resp_headers[key] = response.headers[key]

        return StreamingResponse(
            stream_generator(),
            status_code=response.status_code,
            headers=resp_headers
        )

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        await client.aclose()
        raise HTTPException(status_code=500, detail="Internal server error while proxying stream.")

# -------------------------------
# WebSocket Endpoint
# -------------------------------
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)

    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(room_id, data)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

# -------------------------------
# Root
# -------------------------------
@app.get("/")
def read_root():
    return {"message": "Welcome to Sonic Jam Backend API"}

# -------------------------------
# Run
# -------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)