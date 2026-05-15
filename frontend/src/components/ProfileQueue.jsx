import { useState, useEffect } from 'react';
import { ListMusic, History, Play, Trash2 } from 'lucide-react';

export default function ProfileQueue({ queue, setQueue, history, fetchHistory, playTrack, hasPermission }) {
  const [activeTab, setActiveTab] = useState('queue');

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab]);

  const handlePlayFromQueue = (track, index) => {
    if (!hasPermission) return;
    // Play track
    playTrack(track.url, track.title);
    // Remove it from queue
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

  return (
    <div className="profile-queue-container glass-panel">
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
                  <li key={idx} className="track-item">
                    <div className="track-info">
                      <span className="track-index">{idx + 1}</span>
                      <span className="track-title">{track.title}</span>
                    </div>
                    {hasPermission && (
                      <div className="track-actions">
                        <button onClick={() => handlePlayFromQueue(track, idx)} title="Play Now"><Play size={14}/></button>
                        <button onClick={() => removeFromQueue(idx)} title="Remove"><Trash2 size={14}/></button>
                      </div>
                    )}
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
                  <li key={idx} className="track-item">
                    <div className="track-info">
                      <span className="track-count">{track.play_count}x</span>
                      <span className="track-title">{track.song_title}</span>
                    </div>
                    {hasPermission && (
                      <div className="track-actions">
                        <button onClick={() => handlePlayFromHistory(track)} title="Play Now"><Play size={14}/></button>
                      </div>
                    )}
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
