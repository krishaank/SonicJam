import { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Play, Pause, Search } from 'lucide-react';
import Visualizer from './components/Visualizer';

function App() {
  const [url, setUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);

  // Initialize Web Audio API on first interaction to bypass browser autoplay policies
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

  const loadAndPlay = async (e) => {
    e?.preventDefault();
    if (!url) return;
    
    setError('');
    setIsLoading(true);
    initAudio();

    try {
      // Pointing to our FastAPI backend running on port 8000
      const backendUrl = `http://localhost:8000/api/stream?url=${encodeURIComponent(url)}`;
      
      if (audioRef.current) {
        audioRef.current.src = backendUrl;
        audioRef.current.load();
        
        // Use play promise to handle errors
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              setIsLoading(false);
            })
            .catch(err => {
              console.error(err);
              setError("Failed to play audio. Make sure the backend is running.");
              setIsLoading(false);
            });
        }
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred while connecting to the stream.");
      setIsLoading(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioRef.current.src) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
      initAudio(); // Ensure context is running
    }
    setIsPlaying(!isPlaying);
  };

  // Setup event listeners for audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
    };
  }, []);

  return (
    <div className="app-container">
      {/* 3D Background */}
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

      {/* Hidden Audio Element */}
      <audio ref={audioRef} crossOrigin="anonymous" />

      {/* UI Overlay */}
      <header className="top-bar">
        <form onSubmit={loadAndPlay} className="search-form glass-panel">
          <input 
            type="text" 
            className="search-input"
            placeholder="Paste YouTube URL here..." 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="play-btn" disabled={isLoading}>
            {isLoading ? <div className="loader"></div> : <Search size={20} />}
          </button>
        </form>
      </header>
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}

      {/* Playback Controls */}
      <footer className="player-bar">
        <div className="glass-panel player-controls">
          <button className="control-btn main" onClick={togglePlay}>
            {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;
