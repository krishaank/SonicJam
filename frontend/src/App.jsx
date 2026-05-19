import { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Play, Pause, Search, Copy, Volume2, VolumeX, User } from 'lucide-react';
import Visualizer from './components/Visualizer';
import Chat from './components/Chat';
import AuthModal from './components/AuthModal';
import ProfileQueue from './components/ProfileQueue';
import LandingPage from './components/LandingPage';

// Generate a random client ID and room ID
const generateId = () => Math.random().toString(36).substring(2, 9);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Room Join State
  const [isEditingRoom, setIsEditingRoom] = useState(false);
  const [joinRoomInput, setJoinRoomInput] = useState('');

  // Auth & DB State
  const [token, setToken] = useState(localStorage.getItem('sonic_token'));
  const [username, setUsername] = useState(localStorage.getItem('sonic_user'));
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  
  // App Entry State
  const [hasEntered, setHasEntered] = useState(!!localStorage.getItem('sonic_token'));

  // Multiplayer state
  const [roomId, setRoomId] = useState('');
  const [clientId] = useState(() => generateId());
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [usernames, setUsernames] = useState({});
  const [hostId, setHostId] = useState(null);
  const [authorizedUsers, setAuthorizedUsers] = useState([]);

  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);

  // Check if current user has control permissions
  const hasPermission = authorizedUsers.includes(clientId);

  // Handle Auth Success
  const handleLoginSuccess = (newToken, newUsername) => {
    setToken(newToken);
    setUsername(newUsername);
    localStorage.setItem('sonic_token', newToken);
    localStorage.setItem('sonic_user', newUsername);
    setShowAuthModal(false);
    setHasEntered(true);
    fetchHistory(newToken);
  };

  const handleLogout = () => {
    setToken(null);
    setUsername(null);
    localStorage.removeItem('sonic_token');
    localStorage.removeItem('sonic_user');
    setHistory([]);
  };

  // Fetch History
  const fetchHistory = async (currentToken = token) => {
    if (!currentToken) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/history`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Log to History
  const logHistory = async (trackUrl, trackTitle) => {
    if (!token) return;
    try {
      await fetch(`${BACKEND_URL}/api/history/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url: trackUrl, title: trackTitle || 'Unknown Track' })
      });
      fetchHistory(); // refresh history after logging
    } catch (e) {
      console.error('Failed to log history', e);
    }
  };

  const updateSharedQueue = (action) => {
    setQueue(prev => {
      const nextQueue = typeof action === 'function' ? action(prev) : action;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_queue', queue: nextQueue }));
      }
      return nextQueue;
    });
  };

  // Sync local volume state to the audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Auto-play next in queue and sync time
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const handleEnded = () => {
      setIsPlaying(false);
      // Only the DJ/Host triggers the next song for the room
      if (hasPermission && queue.length > 0) {
        const nextTrack = queue[0];
        updateSharedQueue(prev => prev.slice(1));
        if (ws?.readyState === WebSocket.OPEN) {
           ws.send(JSON.stringify({ type: 'load_url', url: nextTrack.url, title: nextTrack.title }));
        }
      }
    };

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    
    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
    };
  }, [queue, hasPermission, ws]);

  // Initialize Room and WebSocket
  useEffect(() => {
    if (!hasEntered) return;

    const params = new URLSearchParams(window.location.search);
    let room = params.get('room');
    if (!room) {
      room = generateId();
      window.history.replaceState({}, '', `?room=${room}`);
    }
    setRoomId(room);

    const websocket = new WebSocket(`${WS_URL}/ws/${room}/${clientId}?username=${encodeURIComponent(username || '')}`);
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'room_state':
          setHostId(data.host_id);
          setAuthorizedUsers(data.authorized_users);
          setUsers(data.users);
          setUsernames(data.usernames || {});
          setQueue(data.queue || []);
          if (data.current_url) {
             playStream(data.current_url, data.is_playing);
          }
          break;
        case 'update_queue':
          setQueue(data.queue || []);
          break;
        case 'user_joined':
          setUsers(data.users);
          setUsernames(data.usernames || {});
          if (data.client_id !== clientId) {
             addSystemMessage(`${data.usernames?.[data.client_id] || 'User ' + data.client_id.substring(0,4)} joined the jam.`);
          }
          break;
        case 'user_left':
          setUsers(data.users);
          setUsernames(data.usernames || {});
          setHostId(data.host_id);
          setAuthorizedUsers(data.authorized_users);
          addSystemMessage(`${data.leaving_username || 'User ' + data.client_id.substring(0,4)} left.`);
          break;
        case 'chat':
          setMessages(prev => [...prev, { sender: data.client_id, text: data.text }]);
          break;
        case 'permission_updated':
          setAuthorizedUsers(data.authorized_users);
          break;
        case 'load_url':
          playStream(data.url, true);
          logHistory(data.url, data.title);
          addSystemMessage(`${data.username || 'User ' + data.client_id.substring(0,4)} dropped a new track!`);
          break;
        case 'play':
          audioRef.current?.play()
            .then(() => setIsPlaying(true))
            .catch(e => console.error("Auto-play blocked:", e));
          break;
        case 'pause':
          audioRef.current?.pause();
          setIsPlaying(false);
          break;
        case 'seek':
          if (audioRef.current) audioRef.current.currentTime = data.time;
          break;
        default:
          break;
      }
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, [clientId, hasEntered]); // Re-run when hasEntered becomes true

  // Broadcast profile update when username changes without reconnecting
  useEffect(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'update_profile', username }));
    }
  }, [username, ws]);

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, { isSystem: true, text }]);
  };

  const sendMessage = (text) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', text }));
    }
  };

  const initAudio = () => {
    if (!audioContextRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContextRef.current = new AudioContext();
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.8;
      
      if (audioRef.current) {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
        sourceRef.current.connect(analyzerRef.current);
        analyzerRef.current.connect(audioContextRef.current.destination);
      }
    }
    
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const playStream = async (streamUrl, startPlaying = true) => {
    setError('');
    setIsLoading(true);
    initAudio();

    try {
      const streamEndpoint = `${BACKEND_URL}/api/stream?url=${encodeURIComponent(streamUrl)}`;
      
      if (audioRef.current) {
        audioRef.current.src = streamEndpoint;
        audioRef.current.load();
        
        if (startPlaying) {
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                setIsPlaying(true);
                setIsLoading(false);
              })
              .catch(err => {
                console.error("Autoplay prevented:", err);
                setError("Click Play to tune in to the jam.");
                setIsLoading(false);
              });
          }
        } else {
          setIsLoading(false);
        }
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred while connecting to the stream.");
      setIsLoading(false);
    }
  };

  // Play Playlist or Track directly
  const executePlay = (trackUrl, trackTitle) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'load_url', url: trackUrl, title: trackTitle }));
    }
  };

  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    if (!url || !hasPermission) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/playlist?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      
      if (data.is_playlist) {
        if (data.tracks && data.tracks.length > 0) {
          updateSharedQueue(data.tracks.slice(1)); // Replace queue
          const firstTrack = data.tracks[0];
          executePlay(firstTrack.url, firstTrack.title);
        } else {
          setError("Could not read playlist. It might be private or empty.");
          setIsLoading(false);
        }
      } else {
        if (data.tracks && data.tracks.length > 0) {
          const track = data.tracks[0];
          executePlay(track.url, track.title);
        } else {
          setError("Could not find any playable tracks.");
          setIsLoading(false);
        }
      }
    } catch (err) {
      setError("Failed to load track or playlist.");
    } finally {
      setIsLoading(false);
      setUrl('');
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioRef.current.src) return;
    
    if (hasPermission) {
      if (isPlaying) {
        ws?.send(JSON.stringify({ type: 'pause' }));
      } else {
        initAudio();
        ws?.send(JSON.stringify({ type: 'play' }));
      }
    } else {
      // Local toggle for guests
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        initAudio();
        audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
      }
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
    
    // Broadcast seek if host
    if (hasPermission && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'seek', time }));
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (joinRoomInput.trim()) {
      window.location.href = `?room=${joinRoomInput.trim()}`;
    }
  };

  const formatTime = (time) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (!hasEntered) {
    return (
      <LandingPage 
        onLoginSuccess={handleLoginSuccess} 
        onEnterGuest={() => setHasEntered(true)} 
      />
    );
  }

  return (
    <div className="app-container">
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onLoginSuccess={handleLoginSuccess} />}

      <div className="canvas-container">
        <Canvas camera={{ position: [0, 0, 8] }}>
          <color attach="background" args={['#050505']} />
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
          <Visualizer analyzer={analyzerRef.current} />
          <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      <audio ref={audioRef} crossOrigin="anonymous" />

      {/* Top Left Badges */}
      <div className="top-left-badges">
        <div className="room-badge glass-panel">
          {isEditingRoom ? (
            <form onSubmit={handleJoinRoom} className="join-room-form">
              <input 
                type="text" 
                placeholder="Enter Room ID" 
                value={joinRoomInput}
                onChange={(e) => setJoinRoomInput(e.target.value)}
                autoFocus
                onBlur={() => setTimeout(() => setIsEditingRoom(false), 150)}
              />
              <button type="submit" className="copy-btn" onMouseDown={(e) => e.preventDefault()}>Go</button>
            </form>
          ) : (
            <>
              <span title="Double click to change room" onDoubleClick={() => { setIsEditingRoom(true); setJoinRoomInput(roomId); }}>
                Room: <b>{roomId}</b>
              </span>
              <div className="room-badge-buttons">
                <button className="copy-btn" onClick={() => { setIsEditingRoom(true); setJoinRoomInput(''); }}>
                  Join
                </button>
                <button className="copy-btn" onClick={() => navigator.clipboard.writeText(roomId)} title="Copy Room ID">
                  <Copy size={16} /> Invite
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <button className="login-trigger-btn" onClick={() => token ? handleLogout() : setShowAuthModal(true)}>
        <User size={18} />
        {token ? `Logout ${username}` : 'Login / Register'}
      </button>

      {/* Left Sidebar Queue */}
      <ProfileQueue 
        queue={queue} 
        setQueue={updateSharedQueue} 
        history={history} 
        fetchHistory={fetchHistory} 
        playTrack={executePlay}
        hasPermission={hasPermission}
      />

      <header className="top-bar">
        <form onSubmit={handleSearchSubmit} className="search-form glass-panel">
          <input 
            type="text" 
            className="search-input"
            placeholder={hasPermission ? "Paste YouTube Video or Playlist URL..." : "Only DJs can change the music..."} 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!hasPermission}
          />
          <button type="submit" className="play-btn" disabled={isLoading || !hasPermission}>
            {isLoading ? <div className="loader"></div> : <Search size={20} />}
          </button>
        </form>
      </header>
      
      {isLoading && (
        <div className="loading-overlay">
          <div className="loader large"></div>
          <p>Extracting Audio Stream...</p>
        </div>
      )}

      {error && <div className="error-message"><p>{error}</p></div>}

      <footer className="player-bar">
        <div className="glass-panel player-wrapper">
          <div className="progress-container">
            <span className="time-text">{formatTime(currentTime)}</span>
            <input 
              type="range" 
              min="0" 
              max={duration || 100} 
              step="0.1"
              value={currentTime} 
              onChange={handleSeek}
              className="progress-slider"
              disabled={!hasPermission && duration === 0}
            />
            <span className="time-text">{formatTime(duration)}</span>
          </div>

          <div className="player-controls">
            <button 
              className={`control-btn main ${!hasPermission ? 'disabled' : ''}`} 
              onClick={togglePlay}
              title={hasPermission ? "Play / Pause for Room" : "Only DJs can pause the music"}
            >
              {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
            
            <div className="volume-control">
              <button className="control-btn" onClick={() => setVolume(volume === 0 ? 1 : 0)}>
                {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input 
                type="range" min="0" max="1" step="0.01" 
                value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="volume-slider"
              />
            </div>
          </div>
        </div>
      </footer>

      <Chat 
        messages={messages} 
        sendMessage={sendMessage} 
        clientId={clientId} 
        users={users}
        usernames={usernames}
        hostId={hostId}
        authorizedUsers={authorizedUsers}
        grantPermission={(id) => ws?.send(JSON.stringify({ type: 'grant_permission', target_id: id }))}
        revokePermission={(id) => ws?.send(JSON.stringify({ type: 'revoke_permission', target_id: id }))}
      />
    </div>
  );
}

export default App;
