from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends, status
import json
from typing import Dict, Set, List
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import httpx
import logging
import asyncio
from functools import lru_cache
from pydantic import BaseModel
from sqlalchemy.orm import Session
import bcrypt
import jwt
from datetime import datetime, timedelta
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import os

# Database imports
from database import engine, Base, get_db, User, PlayHistory

Base.metadata.create_all(bind=engine)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Sonic Jam Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Security Config ---
SECRET_KEY = "sonicjam_super_secret_key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_byte_enc = plain_password.encode('utf-8')
    hashed_password_byte_enc = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_byte_enc, hashed_password_byte_enc)

def get_password_hash(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(pwd_bytes, salt)
    return hashed_password.decode('utf-8')

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# Pydantic models
class UserCreate(BaseModel):
    username: str
    password: str

class PlayLog(BaseModel):
    url: str
    title: str

# --- Authentication Endpoints ---
@app.post("/api/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_pw = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_pw)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User registered successfully"}

@app.post("/api/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "username": user.username}

@app.post("/api/history/log")
def log_play(log: PlayLog, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    history_entry = db.query(PlayHistory).filter(
        PlayHistory.user_id == current_user.id,
        PlayHistory.song_url == log.url
    ).first()
    if history_entry:
        history_entry.play_count += 1
    else:
        new_entry = PlayHistory(
            user_id=current_user.id,
            song_url=log.url,
            song_title=log.title,
            play_count=1
        )
        db.add(new_entry)
    db.commit()
    return {"message": "Logged successfully"}

@app.get("/api/history")
def get_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    history = db.query(PlayHistory).filter(PlayHistory.user_id == current_user.id)\
                .order_by(PlayHistory.play_count.desc()).limit(10).all()
    return history

# --- Playlist Extraction ---
@app.get("/api/playlist")
async def extract_playlist(url: str):
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    ydl_opts = {
        'extract_flat': 'in_playlist', 
        'quiet': True, 
        'no_warnings': True,
        'format': 'bestaudio/best',
        'ignoreerrors': True,
        'extractor_args': {'youtube': {'client': ['ANDROID_MUSIC', 'TV', 'WEB', 'IOS']}}
    }
    if os.path.exists('cookies.txt'):
        ydl_opts['cookiefile'] = 'cookies.txt'
    def extract():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            return ydl.extract_info(url, download=False)
    try:
        info = await asyncio.to_thread(extract)
        if 'entries' in info:
            tracks = []
            for entry in info['entries']:
                url_val = entry.get('url')
                if url_val:
                    # yt-dlp sometimes returns just the video ID or relative URL
                    if not url_val.startswith('http'):
                        if url_val.startswith('/watch'):
                            url_val = f"https://www.youtube.com{url_val}"
                        else:
                            url_val = f"https://www.youtube.com/watch?v={url_val}"
                    tracks.append({
                        "title": entry.get('title', 'Unknown Track'),
                        "url": url_val
                    })
            return {"is_playlist": True, "tracks": tracks, "title": info.get('title', 'Playlist')}
        else:
            return {
                "is_playlist": False, 
                "tracks": [{"title": info.get('title', 'Unknown Track'), "url": info.get('webpage_url', url)}]
            }
    except Exception as e:
        logger.error(f"Error extracting playlist: {e}")
        raise HTTPException(status_code=400, detail="Could not extract playlist")

# --- WebSockets Room Manager ---
class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.connections: Dict[str, WebSocket] = {}
        self.host_id: str = None
        self.authorized_users: Set[str] = set()
        self.current_url: str = ""
        self.current_title: str = "Unknown Track"
        self.is_playing: bool = False
        self.usernames: Dict[str, str] = {}
        
    async def broadcast(self, message: dict):
        for connection in self.connections.values():
            try:
                await connection.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Error broadcasting to a client: {e}")

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}

    def get_or_create_room(self, room_id: str) -> Room:
        if room_id not in self.rooms:
            self.rooms[room_id] = Room(room_id)
        return self.rooms[room_id]

    async def connect(self, websocket: WebSocket, room_id: str, client_id: str, username: str = None):
        await websocket.accept()
        room = self.get_or_create_room(room_id)
        room.connections[client_id] = websocket
        if username:
            room.usernames[client_id] = username
        if not room.host_id:
            room.host_id = client_id
            room.authorized_users.add(client_id)
            logger.info(f"Client {client_id} became host of room {room_id}")
        await websocket.send_text(json.dumps({
            "type": "room_state",
            "host_id": room.host_id,
            "authorized_users": list(room.authorized_users),
            "current_url": room.current_url,
            "current_title": room.current_title,
            "is_playing": room.is_playing,
            "users_count": len(room.connections),
            "users": list(room.connections.keys()),
            "usernames": room.usernames
        }))
        await room.broadcast({
            "type": "user_joined",
            "client_id": client_id,
            "users_count": len(room.connections),
            "users": list(room.connections.keys()),
            "usernames": room.usernames
        })

    def disconnect(self, room_id: str, client_id: str):
        if room_id in self.rooms:
            room = self.rooms[room_id]
            if client_id in room.connections:
                del room.connections[client_id]
            if client_id in room.usernames:
                del room.usernames[client_id]
            if room.host_id == client_id:
                if room.connections:
                    new_host = list(room.connections.keys())[0]
                    room.host_id = new_host
                    room.authorized_users.add(new_host)
                else:
                    room.host_id = None
            if not room.connections:
                del self.rooms[room_id]

    async def handle_message(self, room_id: str, client_id: str, message: dict):
        room = self.rooms.get(room_id)
        if not room: return
        msg_type = message.get("type")
        
        if msg_type == "chat":
            await room.broadcast({"type": "chat", "client_id": client_id, "text": message.get("text")})
            return

        if msg_type == "update_profile":
            new_username = message.get("username")
            if new_username:
                room.usernames[client_id] = new_username
            else:
                room.usernames.pop(client_id, None)
            
            await room.broadcast({
                "type": "user_joined", # Reuse user_joined to broadcast state change easily
                "client_id": client_id,
                "users_count": len(room.connections),
                "users": list(room.connections.keys()),
                "usernames": room.usernames
            })
            return

        if msg_type == "grant_permission":
            if client_id == room.host_id:
                target_id = message.get("target_id")
                if target_id in room.connections:
                    room.authorized_users.add(target_id)
                    await room.broadcast({"type": "permission_updated", "authorized_users": list(room.authorized_users)})
            return
            
        if msg_type == "revoke_permission":
            if client_id == room.host_id:
                target_id = message.get("target_id")
                if target_id in room.authorized_users and target_id != room.host_id:
                    room.authorized_users.remove(target_id)
                    await room.broadcast({"type": "permission_updated", "authorized_users": list(room.authorized_users)})
            return

        if client_id not in room.authorized_users:
            return 
            
        if msg_type == "load_url":
            room.current_url = message.get("url")
            room.current_title = message.get("title", "Unknown Track")
            room.is_playing = True
            await room.broadcast({
                "type": "load_url", 
                "url": room.current_url, 
                "title": room.current_title, 
                "client_id": client_id,
                "username": room.usernames.get(client_id)
            })
        elif msg_type == "play":
            room.is_playing = True
            await room.broadcast({"type": "play", "client_id": client_id})
        elif msg_type == "pause":
            room.is_playing = False
            await room.broadcast({"type": "pause", "client_id": client_id})
        elif msg_type == "seek":
            await room.broadcast({"type": "seek", "time": message.get("time"), "client_id": client_id})

manager = ConnectionManager()

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str, username: str = None):
    await manager.connect(websocket, room_id, client_id, username)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                await manager.handle_message(room_id, client_id, message)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        room = manager.rooms.get(room_id)
        leaving_username = room.usernames.get(client_id) if room else None
        
        manager.disconnect(room_id, client_id)
        room = manager.rooms.get(room_id)
        if room:
            await room.broadcast({
                "type": "user_left",
                "client_id": client_id,
                "leaving_username": leaving_username,
                "users_count": len(room.connections),
                "users": list(room.connections.keys()),
                "host_id": room.host_id,
                "authorized_users": list(room.authorized_users),
                "usernames": room.usernames
            })

# --- Stream Proxy Engine ---
@lru_cache(maxsize=32)
def get_audio_url(youtube_url: str) -> str:
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'youtube_include_dash_manifest': False,
        'extractor_args': {'youtube': {'client': ['ANDROID_MUSIC', 'TV', 'WEB', 'IOS']}}
    }
    if os.path.exists('cookies.txt'):
        ydl_opts['cookiefile'] = 'cookies.txt'
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            return info['url']
    except Exception as e:
        logger.error(f"Error extracting audio URL: {e}")
        raise ValueError("Failed to extract audio URL from the provided link.")

@app.get("/api/stream")
async def stream_audio(url: str, request: Request):
    if not url:
        raise HTTPException(status_code=400, detail="Missing YouTube URL")
    try:
        audio_stream_url = await asyncio.to_thread(get_audio_url, url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    client = httpx.AsyncClient(follow_redirects=True)
    headers = {}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]

    try:
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
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/")
def read_root():
    return {"message": "Welcome to Sonic Jam API Phase 3"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
