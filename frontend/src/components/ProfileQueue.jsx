import { useState, useEffect } from 'react';
import { ListMusic, History, Play, Trash2, Heart, X } from 'lucide-react';

export default function ProfileQueue({ 
  queue, 
  setQueue, 
  history, 
  fetchHistory, 
  playTrack, 
  hasPermission,
  users,
  usernames,
  onDedicate,
  className = ''
}) {
  const [activeTab, setActiveTab] = useState('queue');
  const [dedicateTarget, setDedicateTarget] = useState(null); // { idx, type }

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab]);

  const handlePlayFromQueue = (track, index) => {
    if (!hasPermission) return;
    playTrack(track.url, track.title);
    setQueue(prev => prev.filter((_, i) => i !== index));
  };

  const handlePlayFromHistory = (track) => {
    if (!hasPermission) return;
    playTrack(track.song_url, track.song_title);
  };

  const removeFromQueue = (index) => {
    if (!hasPermission) return;
    setQueue(prev => prev.filter((_, i) => i !== index));
  };

  const submitDedication = (track, type, targetUserId, index) => {
    const url = type === 'queue' ? track.url : track.song_url;
    const title = type === 'queue' ? track.title : track.song_title;
    const targetUsername = usernames[targetUserId] || `User ${targetUserId.substring(0,4)}`;
    
    onDedicate(url, title, targetUsername);
    setDedicateTarget(null);
    
    if (type === 'queue') {
      setQueue(prev => prev.filter((_, i) => i !== index));
    }
  };

  const renderDedicateDropdown = (track, type, idx) => {
    if (dedicateTarget?.idx !== idx || dedicateTarget?.type !== type) return null;
    return (
      <div className="dedicate-dropdown glass-panel">
        <div className="dropdown-header">
          <span>Dedicate to:</span>
          <button className="close-btn" onClick={() => setDedicateTarget(null)}><X size={12}/></button>
        </div>
        <div className="dropdown-users">
          {users.length === 0 ? <span className="no-users">No other users</span> : null}
          {users.map(u => (
            <button key={u} onClick={() => submitDedication(track, type, u, idx)}>
              {usernames[u] || `User ${u.substring(0,4)}`}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`profile-queue-container glass-panel ${className}`}>
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          <ListMusic size={16} /> Up Next
        </button>
        <button 
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={16} /> Most Played
        </button>
      </div>

      <div className="list-content">
        {activeTab === 'queue' && (
          <div className="queue-list">
            {queue.length === 0 ? (
              <p className="empty-state">Queue is empty.<br/>Paste a playlist URL to add tracks!</p>
            ) : (
              <ul>
                {queue.map((track, idx) => (
                  <li key={idx} className="track-item" style={{ position: 'relative' }}>
                    <div className="track-info">
                      <span className="track-index">{idx + 1}</span>
                      <span className="track-title">
                        {track.title}
                        {track.addedBy && <span className="added-by"> (by {track.addedBy})</span>}
                      </span>
                    </div>
                    {hasPermission && (
                      <div className="track-actions">
                        <button onClick={() => setDedicateTarget({idx, type: 'queue'})} title="Dedicate to someone"><Heart size={14}/></button>
                        <button onClick={() => handlePlayFromQueue(track, idx)} title="Play Now"><Play size={14}/></button>
                        <button onClick={() => removeFromQueue(idx)} title="Remove"><Trash2 size={14}/></button>
                      </div>
                    )}
                    {renderDedicateDropdown(track, 'queue', idx)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="history-list">
            {!history || history.length === 0 ? (
              <p className="empty-state">No play history yet.<br/>Log in and play some tracks!</p>
            ) : (
              <ul>
                {history.map((track, idx) => (
                  <li key={idx} className="track-item" style={{ position: 'relative' }}>
                    <div className="track-info">
                      <span className="track-count">{track.play_count}x</span>
                      <span className="track-title">{track.song_title}</span>
                    </div>
                    {hasPermission && (
                      <div className="track-actions">
                        <button onClick={() => setDedicateTarget({idx, type: 'history'})} title="Dedicate to someone"><Heart size={14}/></button>
                        <button onClick={() => handlePlayFromHistory(track)} title="Play Now"><Play size={14}/></button>
                      </div>
                    )}
                    {renderDedicateDropdown(track, 'history', idx)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
