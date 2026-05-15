import { useState } from 'react';
import { User, Lock, LogIn, UserPlus, Music, ArrowRight } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export default function LandingPage({ onLoginSuccess, onEnterGuest }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isLogin) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch(`${BACKEND_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Login failed');
        
        onLoginSuccess(data.access_token, data.username);
      } else {
        const res = await fetch(`${BACKEND_URL}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Registration failed');
        
        setIsLogin(true);
        setError('Registration successful! Please log in.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="landing-page">
      <div className="landing-content glass-panel">
        <div className="landing-brand">
          <div className="logo-container">
            <Music size={40} className="logo-icon" />
          </div>
          <h1>Sonic Jam</h1>
          <p>Sync your tunes. Jam with friends.</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form landing-form">
          <div className="form-toggle">
            <button type="button" className={`toggle-btn ${isLogin ? 'active' : ''}`} onClick={() => {setIsLogin(true); setError('');}}>Login</button>
            <button type="button" className={`toggle-btn ${!isLogin ? 'active' : ''}`} onClick={() => {setIsLogin(false); setError('');}}>Register</button>
          </div>

          <div className="input-group">
            <User size={18} className="input-icon" />
            <input 
              type="text" 
              placeholder="Username" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required 
            />
          </div>
          
          <div className="input-group">
            <Lock size={18} className="input-icon" />
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>

          {error && <div className={`auth-message ${error.includes('successful') ? 'success' : 'error'}`}>{error}</div>}

          <button type="submit" className="landing-submit primary-btn" disabled={isLoading || !username || !password}>
            {isLoading ? <div className="loader small"></div> : (isLogin ? <><LogIn size={18}/> Let's Jam</> : <><UserPlus size={18}/> Create Account</>)}
          </button>
        </form>

        <div className="landing-divider">
          <span>or</span>
        </div>

        <button className="guest-btn" onClick={onEnterGuest}>
          Continue as Guest <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
