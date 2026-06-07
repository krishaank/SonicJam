import React, { useEffect, useRef, useState } from 'react';
import { Mic2, X, Plus, Minus } from 'lucide-react';

export default function LyricsOverlay({ lyricsData, currentTime, isVisible, onClose }) {
  const containerRef = useRef(null);
  const [syncOffset, setSyncOffset] = useState(0);

  // Reset offset when new song starts
  useEffect(() => {
    setSyncOffset(0);
  }, [lyricsData]);

  // Find the active lyric index
  let activeIndex = -1;
  const effectiveTime = currentTime - syncOffset;

  if (lyricsData && lyricsData.length > 0) {
    for (let i = 0; i < lyricsData.length; i++) {
      if (effectiveTime >= lyricsData[i].time) {
        activeIndex = i;
      } else {
        break; // Lyrics are sorted by time
      }
    }
  }

  // Auto-scroll to active line
  useEffect(() => {
    if (isVisible && activeIndex >= 0 && containerRef.current) {
      const activeElement = containerRef.current.querySelector('.lyric-line.active');
      if (activeElement) {
        const container = containerRef.current;
        const scrollTarget = activeElement.offsetTop - (container.clientHeight / 2) + (activeElement.clientHeight / 2);
        container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      }
    }
  }, [activeIndex, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="lyrics-overlay glass-panel">
      <div className="lyrics-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h2><Mic2 size={20} /> Karaoke Mode</h2>
          {lyricsData && lyricsData.length > 0 && (
            <div className="sync-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: '20px', fontSize: '0.85rem' }}>
              <span style={{ opacity: 0.7 }}>Sync:</span>
              <button 
                onClick={() => setSyncOffset(s => s - 0.5)} 
                title="Make lyrics appear earlier"
                style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <Minus size={14} />
              </button>
              <span style={{ minWidth: '35px', textAlign: 'center', fontWeight: 'bold' }}>
                {(syncOffset > 0 ? '+' : '')}{syncOffset.toFixed(1)}s
              </span>
              <button 
                onClick={() => setSyncOffset(s => s + 0.5)} 
                title="Make lyrics appear later"
                style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
        <button className="close-btn" onClick={onClose}><X size={20} /></button>
      </div>
      
      <div className="lyrics-content" ref={containerRef}>
        {!lyricsData || lyricsData.length === 0 ? (
          <div className="no-lyrics">
            <p>No synchronized lyrics found for this track.</p>
            <p className="sub-text">Instrumental or unmapped song.</p>
          </div>
        ) : (
          lyricsData.map((line, idx) => (
            <p 
              key={idx} 
              className={`lyric-line ${idx === activeIndex ? 'active' : ''} ${idx < activeIndex ? 'passed' : ''}`}
            >
              {line.text || "♪"}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
