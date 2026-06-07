import { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Play, Pause, Search, Copy, Volume2, VolumeX, User, Mic2, Heart, X, MessageCircle, ListMusic } from 'lucide-react';
import Visualizer from './components/Visualizer';
import Chat from './components/Chat';
import AuthModal from './components/AuthModal';
import ProfileQueue from './components/ProfileQueue';
import LandingPage from './components/LandingPage';
import LyricsOverlay from './components/LyricsOverlay';

const generateId = () => Math.random().toString(36).substring(2, 9);

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

const CROSSFADE_DURATION = 5; // seconds

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isCrossfading, setIsCrossfading] = useState(false);

  // Lyrics State
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState([]);
  const [currentTitle, setCurrentTitle] = useState('');

  // Room Join State
  const [isEditingRoom, setIsEditingRoom] = useState(false);
  const [joinRoomInput, setJoinRoomInput] = useState('');
  const [bottomDedicateOpen, setBottomDedicateOpen] = useState(false);

  // Mobile UI State
  const [mobileView, setMobileView] = useState('none');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

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

  // Audio Refs — deck A (active) and deck B (crossfade preload)
  const audioRef = useRef(null);
  const audioRef2 = useRef(null);
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);
  const gainNode1Ref = useRef(null);
  const gainNode2Ref = useRef(null);
  const source1Ref = useRef(null);
  const source2Ref = useRef(null);
  const crossfadeTriggeredRef = useRef(false);
  const queueRef = useRef([]);
  const wsRef = useRef(null);

  const hasPermission = authorizedUsers.includes(clientId);
  const hasPermissionRef = useRef(hasPermission);
  useEffect(() => { hasPermissionRef.current = hasPermission; }, [hasPermission]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { wsRef.current = ws; }, [ws]);

  // Sync volume to active gain node
  useEffect(() => {
    if (gainNode1Ref.current && !isCrossfading) {
      gainNode1Ref.current.gain.value = volume;
    }
  }, [volume, isCrossfading]);

  // --- Lyrics ---
  const parseLrc = (lrcString) => {
    if (!lrcString) return [];
    const lines = lrcString.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    for (const line of lines) {
      const match = line.match(timeRegex);
      if (match) {
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        const ms = parseInt(match[3]);
        const time = min * 60 + sec + (ms / (match[3].length === 2 ? 100 : 1000));
        const text = line.replace(timeRegex, '').trim();
        parsed.push({ time, text });
      }
    }
    return parsed;
  };

  const fetchLyrics = async (title) => {
    if (!title) return;
    try {
      setLyricsData([]);
      const query = encodeURIComponent(title);
      const res = await fetch(`https://lrclib.net/api/search?q=${query}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data.find(d => d.syncedLyrics) || data[0];
        if (item && item.syncedLyrics) {
          setLyricsData(parseLrc(item.syncedLyrics));
        }
      }
    } catch (e) {
      console.error("Lyrics fetch failed", e);
    }
  };

  useEffect(() => {
    if (currentTitle) fetchLyrics(currentTitle);
  }, [currentTitle]);

  // --- Auth & History ---
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
      fetchHistory();
    } catch (e) {
      console.error('Failed to log history', e);
    }
  };

  // --- Shared Queue ---
  const updateSharedQueue = (action) => {
    setQueue(prev => {
      const nextQueue = typeof action === 'function' ? action(prev) : action;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'update_queue', queue: nextQueue }));
      }
      return nextQueue;
    });
  };

  // --- Web Audio Init ---
  const initAudio = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();

      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.8;
      analyzerRef.current.connect(audioContextRef.current.destination);

      gainNode1Ref.current = audioContextRef.current.createGain();
      gainNode1Ref.current.gain.value = volume;
      gainNode1Ref.current.connect(analyzerRef.current);

      gainNode2Ref.current = audioContextRef.current.createGain();
      gainNode2Ref.current.gain.value = 0;
      gainNode2Ref.current.connect(analyzerRef.current);
    }

    if (!source1Ref.current && audioRef.current) {
      source1Ref.current = audioContextRef.current.createMediaElementSource(audioRef.current);
      source1Ref.current.connect(gainNode1Ref.current);
    }

    if (!source2Ref.current && audioRef2.current) {
      source2Ref.current = audioContextRef.current.createMediaElementSource(audioRef2.current);
      source2Ref.current.connect(gainNode2Ref.current);
    }

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, [volume]);

  // --- Crossfade Logic ---
  const triggerCrossfade = useCallback((nextTrackUrl, nextTrackTitle) => {
    const ctx = audioContextRef.current;
    const gainA = gainNode1Ref.current;
    const gainB = gainNode2Ref.current;
    const deckB = audioRef2.current;

    if (!ctx || !gainA || !gainB || !deckB) return;

    setIsCrossfading(true);

    const streamEndpoint = `${BACKEND_URL}/api/stream?url=${encodeURIComponent(nextTrackUrl)}`;
    deckB.src = streamEndpoint;
    deckB.load();
    deckB.play().catch(e => console.warn('Deck B autoplay blocked:', e));

    const now = ctx.currentTime;
    const fadeEnd = now + CROSSFADE_DURATION;

    gainA.gain.cancelScheduledValues(now);
    gainA.gain.setValueAtTime(gainA.gain.value, now);
    gainA.gain.linearRampToValueAtTime(0, fadeEnd);

    gainB.gain.cancelScheduledValues(now);
    gainB.gain.setValueAtTime(0, now);
    gainB.gain.linearRampToValueAtTime(volume, fadeEnd);

    setTimeout(() => {
      const deckA = audioRef.current;
      if (deckA) {
        deckA.pause();
        deckA.src = '';
      }

      if (audioRef.current && audioRef2.current) {
        audioRef.current.src = audioRef2.current.src;
        audioRef2.current.src = '';
      }

      gainA.gain.cancelScheduledValues(ctx.currentTime);
      gainA.gain.setValueAtTime(volume, ctx.currentTime);
      gainB.gain.cancelScheduledValues(ctx.currentTime);
      gainB.gain.setValueAtTime(0, ctx.currentTime);

      crossfadeTriggeredRef.current = false;
      setIsCrossfading(false);
      setIsPlaying(true);
      setCurrentTitle(nextTrackTitle || '');
      logHistory(nextTrackUrl, nextTrackTitle);
      addSystemMessage(`🎛️ Crossfaded into next track!`);
    }, CROSSFADE_DURATION * 1000);
  }, [volume]);

  // --- Auto-play next in queue + crossfade trigger ---
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      crossfadeTriggeredRef.current = false;
      if (hasPermissionRef.current && queueRef.current.length > 0) {
        const nextTrack = queueRef.current[0];
        updateSharedQueue(prev => prev.slice(1));
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'load_url', url: nextTrack.url, title: nextTrack.title }));
        }
      }
    };

    const handleTimeUpdate = () => {
      const timeLeft = audio.duration - audio.currentTime;
      setCurrentTime(audio.currentTime);

      if (
        hasPermissionRef.current &&
        queueRef.current.length > 0 &&
        !isNaN(audio.duration) &&
        audio.duration > 0 &&
        timeLeft <= CROSSFADE_DURATION &&
        timeLeft > 0 &&
        !crossfadeTriggeredRef.current
      ) {
        crossfadeTriggeredRef.current = true;
        const nextTrack = queueRef.current[0];
        updateSharedQueue(prev => prev.slice(1));

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'load_url',
            url: nextTrack.url,
            title: nextTrack.title
          }));
        }

        triggerCrossfade(nextTrack.url, nextTrack.title);
      }
    };

    const updateDuration = () => setDuration(audio.duration);

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', updateDuration);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', updateDuration);
    };
  }, [triggerCrossfade]);

  // --- WebSocket / Room Init ---
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
          if (data.current_title) setCurrentTitle(data.current_title);
          if (data.current_url) playStream(data.current_url, data.is_playing);
          break;
        case 'update_queue':
          setQueue(data.queue || []);
          break;
        case 'user_joined':
          setUsers(data.users);
          setUsernames(data.usernames || {});
          if (data.client_id !== clientId) {
            addSystemMessage(`${data.usernames?.[data.client_id] || 'User ' + data.client_id.substring(0, 4)} joined the jam.`);
          }
          break;
        case 'user_left':
          setUsers(data.users);
          setUsernames(data.usernames || {});
          setHostId(data.host_id);
          setAuthorizedUsers(data.authorized_users);
          addSystemMessage(`${data.leaving_username || 'User ' + data.client_id.substring(0, 4)} left.`);
          break;
        case 'chat':
          setMessages(prev => [...prev, {
            sender: data.client_id,
            text: data.text,
            isSystem: data.client_id === 'system'
          }]);
          break;
        case 'permission_updated':
          setAuthorizedUsers(data.authorized_users);
          break;
        case 'load_url':
          setCurrentTitle(data.title || '');
          playStream(data.url, true);
          logHistory(data.url, data.title);
          addSystemMessage(`${data.username || usernames[data.client_id] || 'User ' + data.client_id?.substring(0, 4)} dropped a new track!`);
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
    return () => websocket.close();
  }, [clientId, hasEntered]);

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

  // --- Stream Playback (direct, no crossfade — for guests and room sync) ---
  const playStream = async (streamUrl, startPlaying = true) => {
    setError('');
    setIsLoading(true);
    initAudio();
    crossfadeTriggeredRef.current = false;

    try {
      const streamEndpoint = `${BACKEND_URL}/api/stream?url=${encodeURIComponent(streamUrl)}`;
      if (audioRef.current) {
        audioRef.current.src = streamEndpoint;
        audioRef.current.load();
        if (startPlaying) {
          audioRef.current.play()
            .then(() => { setIsPlaying(true); setIsLoading(false); })
            .catch(err => {
              console.error("Autoplay prevented:", err);
              setError("Click Play to tune in to the jam.");
              setIsLoading(false);
            });
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

      let trackToPlay = null;
      if (data.is_playlist) {
        if (data.tracks && data.tracks.length > 0) {
          updateSharedQueue(data.tracks.slice(1));
          trackToPlay = data.tracks[0];
        } else {
          setError("Could not read playlist. It might be private or empty.");
        }
      } else {
        if (data.tracks && data.tracks.length > 0) {
          trackToPlay = data.tracks[0];
        } else {
          setError("Could not find any playable tracks.");
        }
      }
      if (trackToPlay) executePlay(trackToPlay.url, trackToPlay.title);
    } catch (err) {
      setError("Failed to load track or playlist.");
    } finally {
      setIsLoading(false);
      setUrl('');
    }
  };

  const handleCurrentSongDedicate = (targetUserId) => {
    if (!hasPermission || !currentTitle) return;
    const targetUsername = usernames[targetUserId] || `User ${targetUserId.substring(0, 4)}`;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'dedication', target: targetUsername, title: currentTitle }));
    }
    setBottomDedicateOpen(false);
  };

  const handleDedicate = (trackUrl, trackTitle, targetUsername) => {
    if (!hasPermission) return;
    executePlay(trackUrl, trackTitle);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'dedication', target: targetUsername, title: trackTitle || "Unknown Track" }));
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
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
    crossfadeTriggeredRef.current = false;
    if (hasPermission && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'seek', time }));
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (joinRoomInput.trim()) window.location.href = `?room=${joinRoomInput.trim()}`;
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

      <LyricsOverlay
        lyricsData={lyricsData}
        currentTime={currentTime}
        isVisible={showLyrics}
        onClose={() => setShowLyrics(false)}
      />

      {/* Two audio elements — deck A (active) and deck B (crossfade preload) */}
      <audio ref={audioRef} crossOrigin="anonymous" />
      <audio ref={audioRef2} crossOrigin="anonymous" />

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
                <button className="copy-btn" onClick={() => { setIsEditingRoom(true); setJoinRoomInput(''); }}>Join</button>
                <button className="copy-btn" onClick={() => navigator.clipboard.writeText(roomId)} title="Copy Room ID">
                  <Copy size={16} /> Invite
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ position: 'absolute', top: '15px', left: '15px', zIndex: 50 }}>
        <button
          className="login-trigger-btn"
          onClick={() => token ? setShowProfileMenu(!showProfileMenu) : setShowAuthModal(true)}
          style={{ width: '40px', height: '40px', padding: 0, borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          title={token ? `Profile (${username})` : 'Login / Register'}
        >
          <User size={18} />
        </button>
        {showProfileMenu && token && (
          <div className="dedicate-dropdown glass-panel" style={{ top: '100%', left: 0, marginTop: '10px', minWidth: '160px' }}>
            <div className="dropdown-users">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '5px 10px', display: 'block', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                Signed in as <br /><b style={{ color: 'var(--text-primary)', display: 'block', marginTop: '4px' }}>{username}</b>
              </span>
              <button
                onClick={() => { handleLogout(); setShowProfileMenu(false); }}
                style={{ color: '#ff4444', textAlign: 'center', marginTop: '5px', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px' }}
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </div>

      <ProfileQueue
        queue={queue}
        setQueue={updateSharedQueue}
        history={history}
        fetchHistory={fetchHistory}
        playTrack={executePlay}
        hasPermission={hasPermission}
        users={users}
        usernames={usernames}
        onDedicate={handleDedicate}
        className={mobileView === 'queue' ? 'mobile-active' : ''}
      />

      <header className="top-bar">
        <form onSubmit={handleSearchSubmit} className="search-form glass-panel">
          <input
            type="text"
            className="search-input"
            placeholder={hasPermission ? "Paste a SoundCloud, Bandcamp, JioSaavn, or YouTube URL..." : "Only DJs can change the music..."}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!hasPermission}
          />
          <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
            <button type="submit" className="play-btn" disabled={isLoading || !hasPermission}>
              {isLoading ? <div className="loader"></div> : <Search size={20} />}
            </button>
          </div>
        </form>
      </header>

      {isLoading && (
        <div className="loading-overlay">
          <div className="loader large"></div>
          <p>Extracting Audio Stream...</p>
        </div>
      )}

      {isCrossfading && (
        <div className="crossfade-indicator glass-panel">
          <span className="crossfade-dot" />
          Crossfading...
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
              className={`control-btn mobile-toggle-btn ${mobileView === 'queue' ? 'active-lyrics' : ''}`}
              onClick={() => setMobileView(mobileView === 'queue' ? 'none' : 'queue')}
              title="Toggle Queue"
            >
              <ListMusic size={20} color={mobileView === 'queue' ? 'var(--primary)' : 'currentColor'} />
            </button>

            <button
              className={`control-btn ${showLyrics ? 'active-lyrics' : ''}`}
              onClick={() => setShowLyrics(!showLyrics)}
              title="Toggle Karaoke Mode"
            >
              <Mic2 size={20} color={showLyrics ? 'var(--primary)' : 'currentColor'} />
            </button>

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

            {hasPermission && currentTitle && (
              <div style={{ position: 'relative', display: 'flex' }}>
                <button
                  className={`control-btn ${bottomDedicateOpen ? 'active-lyrics' : ''}`}
                  onClick={() => setBottomDedicateOpen(!bottomDedicateOpen)}
                  title="Dedicate current song"
                >
                  <Heart size={20} color={bottomDedicateOpen ? 'var(--primary)' : 'currentColor'} />
                </button>
                {bottomDedicateOpen && (
                  <div className="dedicate-dropdown glass-panel" style={{ bottom: '100%', top: 'auto', right: 0, marginBottom: '15px' }}>
                    <div className="dropdown-header">
                      <span>Dedicate to:</span>
                      <button type="button" className="close-btn" onClick={() => setBottomDedicateOpen(false)}><X size={12} /></button>
                    </div>
                    <div className="dropdown-users">
                      {users.length === 0 ? <span className="no-users">No other users</span> : null}
                      {users.map(u => (
                        <button type="button" key={u} onClick={() => handleCurrentSongDedicate(u)}>
                          {usernames[u] || `User ${u.substring(0, 4)}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              className={`control-btn mobile-toggle-btn ${mobileView === 'chat' ? 'active-lyrics' : ''}`}
              onClick={() => setMobileView(mobileView === 'chat' ? 'none' : 'chat')}
              title="Toggle Chat"
            >
              <MessageCircle size={20} color={mobileView === 'chat' ? 'var(--primary)' : 'currentColor'} />
            </button>
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
        className={mobileView === 'chat' ? 'mobile-active' : ''}
      />
    </div>
  );
}

export default App;
