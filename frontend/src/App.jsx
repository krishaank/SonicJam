import { useState, useRef, useEffect, useCallback } from 'react';
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

// How many seconds before the end of a track to begin the crossfade
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

  // --- Audio Refs ---
  // Two audio elements for crossfading (A/B swap pattern)
  const audioRef = useRef(null);   // Currently playing ("deck A")
  const audioRef2 = useRef(null);  // Preloading next track ("deck B")

  // Web Audio API refs
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);

  // Each audio element gets its own GainNode for independent volume control
  const gainNode1Ref = useRef(null); // Gain for audioRef  (deck A)
  const gainNode2Ref = useRef(null); // Gain for audioRef2 (deck B)

  // MediaElementSourceNode — created once per audio element, never recreated
  const source1Ref = useRef(null);
  const source2Ref = useRef(null);

  // Tracks whether a crossfade has already been triggered for the current track
  // Prevents re-triggering as timeupdate fires many times in the fade window
  const crossfadeTriggeredRef = useRef(false);

  // Ref mirror of queue for use inside event listeners without stale closures
  const queueRef = useRef([]);

  // Ref mirror of ws for use inside event listeners
  const wsRef = useRef(null);

  // Check if current user has control permissions
  const hasPermission = authorizedUsers.includes(clientId);
  const hasPermissionRef = useRef(hasPermission);
  useEffect(() => { hasPermissionRef.current = hasPermission; }, [hasPermission]);

  // Keep queueRef in sync with queue state
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Keep wsRef in sync with ws state
  useEffect(() => { wsRef.current = ws; }, [ws]);

  // Sync local volume state to BOTH audio elements
  useEffect(() => {
    // We control perceived volume via the GainNodes, but keep the
    // HTML element volume at 1 so the GainNode is the single source of truth.
    // We only apply the UI volume slider to the active gain node.
    if (gainNode1Ref.current) {
      // Only set if deck A is not in the middle of a crossfade ramp
      if (!isCrossfading) {
        gainNode1Ref.current.gain.value = volume;
      }
    }
  }, [volume, isCrossfading]);

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

  // --- Web Audio Init ---
  // Sets up AudioContext, Analyzer, and TWO GainNodes — one per deck.
  // Safe to call multiple times; idempotent after first call.
  const initAudio = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();

      // Single shared analyzer — both decks feed into it
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.8;
      analyzerRef.current.connect(audioContextRef.current.destination);

      // Gain node for deck A (audioRef)
      gainNode1Ref.current = audioContextRef.current.createGain();
      gainNode1Ref.current.gain.value = volume;
      gainNode1Ref.current.connect(analyzerRef.current);

      // Gain node for deck B (audioRef2)
      gainNode2Ref.current = audioContextRef.current.createGain();
      gainNode2Ref.current.gain.value = 0; // starts silent
      gainNode2Ref.current.connect(analyzerRef.current);
    }

    // Wire deck A source (created only once)
    if (!source1Ref.current && audioRef.current) {
      source1Ref.current = audioContextRef.current.createMediaElementSource(audioRef.current);
      source1Ref.current.connect(gainNode1Ref.current);
    }

    // Wire deck B source (created only once)
    if (!source2Ref.current && audioRef2.current) {
      source2Ref.current = audioContextRef.current.createMediaElementSource(audioRef2.current);
      source2Ref.current.connect(gainNode2Ref.current);
    }

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, [volume]);

  // --- Crossfade Logic ---
  // Called when deck A is near its end and there's a next track in the queue.
  // Ramps deck A gain to 0 and deck B gain to `volume` over CROSSFADE_DURATION seconds,
  // then swaps the deck A/B roles by swapping the src attributes.
  const triggerCrossfade = useCallback((nextTrackUrl, nextTrackTitle) => {
    const ctx = audioContextRef.current;
    const gainA = gainNode1Ref.current;
    const gainB = gainNode2Ref.current;
    const deckB = audioRef2.current;

    if (!ctx || !gainA || !gainB || !deckB) return;

    setIsCrossfading(true);

    // Preload next track on deck B and start it silently
    const streamEndpoint = `${BACKEND_URL}/api/stream?url=${encodeURIComponent(nextTrackUrl)}`;
    deckB.src = streamEndpoint;
    deckB.load();

    deckB.play().catch(e => console.warn('Deck B autoplay blocked:', e));

    // Schedule the gain ramp using Web Audio API's built-in linear ramp
    // This is sample-accurate and doesn't cause audio glitches unlike setInterval
    const now = ctx.currentTime;
    const fadeEnd = now + CROSSFADE_DURATION;

    // Fade out deck A
    gainA.gain.cancelScheduledValues(now);
    gainA.gain.setValueAtTime(gainA.gain.value, now);
    gainA.gain.linearRampToValueAtTime(0, fadeEnd);

    // Fade in deck B
    gainB.gain.cancelScheduledValues(now);
    gainB.gain.setValueAtTime(0, now);
    gainB.gain.linearRampToValueAtTime(volume, fadeEnd);

    // After the crossfade completes, make deck B the new deck A
    setTimeout(() => {
      const deckA = audioRef.current;
      if (deckA) {
        deckA.pause();
        deckA.src = '';
      }

      // Swap: copy deck B's src onto deck A, reset deck B
      if (audioRef.current && audioRef2.current) {
        audioRef.current.src = audioRef2.current.src;
        audioRef2.current.src = '';
      }

      // Reset gains: deck A is now the active deck, deck B is silent standby
      gainA.gain.cancelScheduledValues(ctx.currentTime);
      gainA.gain.setValueAtTime(volume, ctx.currentTime);
      gainB.gain.cancelScheduledValues(ctx.currentTime);
      gainB.gain.setValueAtTime(0, ctx.currentTime);

      // Reset trigger guard for the new track
      crossfadeTriggeredRef.current = false;
      setIsCrossfading(false);
      setIsPlaying(true);

      // Log history for the new track
      logHistory(nextTrackUrl, nextTrackTitle);
      addSystemMessage(`🎛️ Crossfaded into next track!`);

    }, CROSSFADE_DURATION * 1000);
  }, [volume]);

  // --- Auto-play next in queue + crossfade trigger ---
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Fires when deck A ends naturally (fallback if crossfade didn't trigger)
    const handleEnded = () => {
      setIsPlaying(false);
      crossfadeTriggeredRef.current = false;
      if (hasPermissionRef.current && queueRef.current.length > 0) {
        const nextTrack = queueRef.current[0];
        setQueue(prev => prev.slice(1));
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'load_url', url: nextTrack.url, title: nextTrack.title }));
        }
      }
    };

    // Fires continuously — we watch for the crossfade window
    const handleTimeUpdate = () => {
      const timeLeft = audio.duration - audio.currentTime;
      setCurrentTime(audio.currentTime);

      // Trigger crossfade if:
      // 1. We're the host (hasPermission)
      // 2. There's a next track in the queue
      // 3. We're within the crossfade window
      // 4. We haven't already triggered it for this track
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
        // Remove from queue state immediately so UI updates
        setQueue(prev => prev.slice(1));

        // Broadcast to room that next track is loading
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'load_url',
            url: nextTrack.url,
            title: nextTrack.title
          }));
        }

        // Trigger local crossfade for the host
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
          if (data.current_url) {
            playStream(data.current_url, data.is_playing);
          }
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
          setMessages(prev => [...prev, { sender: data.client_id, text: data.text }]);
          break;
        case 'permission_updated':
          setAuthorizedUsers(data.authorized_users);
          break;
        case 'load_url':
          // Non-hosts receive load_url and play the track directly (no crossfade, just sync)
          playStream(data.url, true);
          logHistory(data.url, data.title);
          addSystemMessage(`${data.usernames?.[data.client_id] || 'User ' + data.client_id?.substring(0, 4)} dropped a new track!`);
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
  }, [clientId, hasEntered]);

  // Broadcast profile update when username changes
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

  // --- Stream Playback ---
  // Used for guests (non-hosts) receiving load_url, and for initial room_state sync.
  // Does NOT crossfade — just loads directly onto deck A.
  const playStream = async (streamUrl, startPlaying = true) => {
    setError('');
    setIsLoading(true);
    initAudio();

    // Reset crossfade guard when a new track is loaded externally
    crossfadeTriggeredRef.current = false;

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
          setQueue(prev => [...prev, ...data.tracks.slice(1)]);
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
    // Reset crossfade guard on manual seek (user might scrub back)
    crossfadeTriggeredRef.current = false;

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
              <button type="submit" className="copy-btn">Go</button>
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
        setQueue={setQueue}
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

      {/* Crossfade indicator — visible only during active transition */}
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
