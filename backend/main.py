from fastapi import FastAPI, HTTPException, Request
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

# Allow all origins for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@lru_cache(maxsize=32)
def get_audio_url(youtube_url: str) -> str:
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True, # Ignore playlist parameters in URL
        'youtube_include_dash_manifest': False, # Speeds up extraction
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            return info['url']
    except Exception as e:
        logger.error(f"Error extracting audio URL: {e}")
        raise ValueError("Failed to extract audio URL from the provided link.")

@app.get("/api/stream")
async def stream_audio(url: str, request: Request):
    """
    Proxy the audio stream from YouTube to bypass CORS restrictions
    on the frontend Web Audio API.
    """
    if not url:
        raise HTTPException(status_code=400, detail="Missing YouTube URL parameter")

    try:
        # Run yt-dlp in a separate thread to prevent blocking the async event loop!
        # And since get_audio_url is cached, subsequent range requests will be instant.
        audio_stream_url = await asyncio.to_thread(get_audio_url, url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # We use httpx to proxy the stream.
    # We must follow redirects because YouTube often returns 302 redirects for stream URLs.
    client = httpx.AsyncClient(follow_redirects=True)
    
    # Forward range headers to support seeking if needed
    headers = {}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]
        logger.info(f"Forwarding Range header: {headers['Range']}")

    try:
        # Start the request to the audio stream URL
        logger.info(f"Proxying stream from URL: {audio_stream_url[:50]}...")
        req = client.build_request("GET", audio_stream_url, headers=headers)
        response = await client.send(req, stream=True)

        async def stream_generator():
            async for chunk in response.aiter_bytes():
                yield chunk
            await client.aclose()

        # Pass through relevant headers
        resp_headers = {}
        for key in ["content-type", "content-length", "accept-ranges", "content-range"]:
            if key in response.headers:
                resp_headers[key] = response.headers[key]

        logger.info(f"Stream started with status {response.status_code} and headers {resp_headers}")

        return StreamingResponse(
            stream_generator(),
            status_code=response.status_code,
            headers=resp_headers
        )

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        await client.aclose()
        raise HTTPException(status_code=500, detail="Internal server error while proxying stream.")

@app.get("/")
def read_root():
    return {"message": "Welcome to Sonic Jam Backend API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
