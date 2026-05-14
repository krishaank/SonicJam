import { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Play, Pause, Search } from 'lucide-react';
import Visualizer from './components/Visualizer';

function App() {
  const [url, setUrl] = useState('');
  const [roomId, setRoomId] = useState('room1');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);

  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);
  const socketRef = useRef(null);

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

  const connectSocket = () => {
    if (!roomId.trim()) {
      setError('Please enter room ID');
      return;
    }

    if (socketRef.current) socketRef.current.close();

    const ws = new WebSocket(`ws://localhost:8000/ws/${roomId}`);

    ws.onopen = () => {
      setJoined(true);
      setError('');
      alert(`Joined room: ${roomId}`);
    };

    ws.onmessage = (event) => {
      const data = event.data;

      if (!audioRef.current) return;

      if (data.startsWith('SONG:')) {
        const sharedUrl = data.replace('SONG:', '');
        setUrl(sharedUrl);

        const backendUrl = `http://localhost:8000/api/stream?url=${encodeURIComponent(sharedUrl)}`;
        audioRef.current.src = backendUrl;
        audioRef.current.load();
      } 
      else if (data === 'play') {
        audioRef.current.play();
        setIsPlaying(true);
      } 
      else if (data === 'pause') {
        audioRef.current.pause();
        setIsPlaying(false);
      } 
      else if (data.startsWith('CHAT:')) {
        const msg = data.replace('CHAT:', '');
        setMessages((prev) => [...prev, msg]);
      } 
      else if (data.startsWith('REACT:')) {
        const emoji = data.replace('REACT:', '');

        const reactionObj = {
          id: Date.now() + Math.random(),
          emoji: emoji
        };

        setReactions(prev => [...prev, reactionObj]);

        setTimeout(() => {
          setReactions(prev => prev.filter(r => r.id !== reactionObj.id));
        }, 3000);
      }
    };

    ws.onerror = () => {
      setError('Failed to join room');
      setJoined(false);
    };

    ws.onclose = () => {
      setJoined(false);
    };

    socketRef.current = ws;
  };

  const sendChat = () => {
    if (!chatMessage.trim()) return;
    if (socketRef.current) {
      socketRef.current.send(`CHAT:${chatMessage}`);
      setChatMessage('');
    }
  };

  const sendReaction = (emoji) => {
    if (socketRef.current) {
      socketRef.current.send(`REACT:${emoji}`);
    }
  };

  const loadAndPlay = async (e) => {
    e?.preventDefault();
    if (!url) return;

    setError('');
    setIsLoading(true);
    initAudio();

    try {
      const backendUrl = `http://localhost:8000/api/stream?url=${encodeURIComponent(url)}`;

      if (audioRef.current) {
        audioRef.current.src = backendUrl;
        audioRef.current.load();

        const playPromise = audioRef.current.play();

        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsPlaying(true);
            setIsLoading(false);

            if (socketRef.current) {
              socketRef.current.send(`SONG:${url}`);
              socketRef.current.send('play');
            }
          });
        }
      }
    } catch (err) {
      setError('Connection failed.');
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioRef.current.src) return;

    if (isPlaying) {
      audioRef.current.pause();
      if (socketRef.current) socketRef.current.send('pause');
    } else {
      audioRef.current.play();
      initAudio();
      if (socketRef.current) socketRef.current.send('play');
    }

    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    connectSocket();
  }, []);

  return (
    <div className="app-container">
      <div className="canvas-container">
        <Canvas camera={{ position: [0, 0, 8] }}>
          <color attach="background" args={['#050505']} />
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <Stars radius={100} depth={50} count={5000} factor={4} />
          <Visualizer analyzer={analyzerRef.current} />
          <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      <audio ref={audioRef} crossOrigin="anonymous" />

      {/* Floating reactions */}
      <div style={{ position: 'absolute', top: '20%', left: '50%', zIndex: 10 }}>
        {reactions.map((r) => (
          <div
            key={r.id}
            style={{
              fontSize: '32px',
              animation: 'floatUp 3s ease-out',
              position: 'absolute',
            }}
          >
            {r.emoji}
          </div>
        ))}
      </div>

      <header className="top-bar">
        <form onSubmit={loadAndPlay} className="search-form glass-panel">
          <input
            type="text"
            className="search-input"
            placeholder="Enter Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />

          <button type="button" className="play-btn" onClick={connectSocket}>
            {joined ? 'Joined' : 'Join'}
          </button>

          <input
            type="text"
            className="search-input"
            placeholder="Paste YouTube URL here..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          <button type="submit" className="play-btn" disabled={isLoading}>
            {isLoading ? '...' : <Search size={20} />}
          </button>
        </form>
      </header>

      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}

      <footer className="player-bar">
        <div className="glass-panel player-controls">
          <button className="control-btn main" onClick={togglePlay}>
            {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
        </div>

        {/* Chat panel */}
        <div
          className="glass-panel"
          style={{
            width: '320px',
            padding: '15px',
            borderRadius: '20px',
            background: 'rgba(20,20,30,0.75)',
          }}
        >
          <h3 style={{ color: '#00ffff', textAlign: 'center' }}>Live Room Chat</h3>

          <div
            style={{
              height: '180px',
              overflowY: 'auto',
              padding: '10px',
              marginBottom: '12px',
            }}
          >
            {messages.map((msg, index) => (
              <div key={index} style={{ color: 'white', marginBottom: '8px' }}>
                🎵 {msg}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              placeholder="Send a message..."
              style={{ flex: 1, padding: '10px' }}
            />
            <button onClick={sendChat}>Send</button>
          </div>

          {/* Reaction buttons */}
          <div style={{ marginTop: '15px', textAlign: 'center' }}>
            <button onClick={() => sendReaction('🔥')}>🔥</button>
            <button onClick={() => sendReaction('❤️')}>❤️</button>
            <button onClick={() => sendReaction('🎵')}>🎵</button>
            <button onClick={() => sendReaction('👏')}>👏</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;