import { useState, useRef, useEffect } from 'react';
import { Send, Users, Shield, ShieldOff, Smile } from 'lucide-react';

const JAM_EMOJIS = ['🔥', '💯', '🎵', '🎸', '🎤', '😂', '❤️', '🎶', '🕺', '💃', '🎧', '🔊', '🎉', '🚀', '💎', '🍿', '👏', '🙌', '🤘', '👑'];

export default function Chat({ 
  messages, 
  sendMessage, 
  clientId, 
  users,
  usernames, 
  hostId, 
  authorizedUsers, 
  grantPermission, 
  revokePermission,
  className = ''
}) {
  const [inputText, setInputText] = useState('');
  const [showUsers, setShowUsers] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText.trim());
    setInputText('');
    setShowEmojiPicker(false);
  };

  const isHost = clientId === hostId;

  return (
    <div className={`chat-container glass-panel ${className}`}>
      {/* Header */}
      <div className="chat-header">
        <h3>Live Jam Chat</h3>
        <button 
          className={`users-btn ${showUsers ? 'active' : ''}`}
          onClick={() => setShowUsers(!showUsers)}
          title="Show Users in Room"
        >
          <Users size={18} />
          <span className="user-count">{users.length}</span>
        </button>
      </div>

      {/* Users List Overlay */}
      {showUsers && (
        <div className="users-list">
          <h4>Users in Room</h4>
          <ul>
            {users.map(user => {
              const userIsHost = user === hostId;
              const hasPermission = authorizedUsers.includes(user);
              
              return (
                <li key={user} className={user === clientId ? 'current-user' : ''}>
                  <span className="user-id">
                    {user === clientId ? 'You' : (usernames[user] || `User ${user.substring(0,4)}`)}
                    {userIsHost && <span className="badge host">HOST</span>}
                    {!userIsHost && hasPermission && <span className="badge dj">DJ</span>}
                  </span>
                  
                  {/* Host Controls */}
                  {isHost && !userIsHost && (
                    <button 
                      className="permission-btn"
                      onClick={() => hasPermission ? revokePermission(user) : grantPermission(user)}
                      title={hasPermission ? "Revoke DJ Control" : "Grant DJ Control"}
                    >
                      {hasPermission ? <ShieldOff size={14} /> : <Shield size={14} />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Messages Area */}
      <div className="messages-area">
        {messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`message ${msg.isSystem ? 'system' : msg.sender === clientId ? 'own' : 'other'} ${msg.isSystem && msg.text.includes('dedicated') ? 'dedication' : ''}`}
          >
            {!msg.isSystem && msg.sender !== clientId && (
              <span className="sender-id">{usernames[msg.sender] || `User ${msg.sender.substring(0,4)}`}</span>
            )}
            <p>{msg.text}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="chat-input-form" style={{ position: 'relative' }}>
        {showEmojiPicker && (
          <div className="emoji-picker glass-panel">
            {JAM_EMOJIS.map(e => (
              <button 
                type="button" 
                key={e} 
                className="emoji-item"
                onClick={() => { setInputText(prev => prev + e); setShowEmojiPicker(false); }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="emoji-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
          <Smile size={18} color={showEmojiPicker ? 'var(--primary)' : 'currentColor'} />
        </button>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Say something..."
          className="chat-input"
        />
        <button type="submit" className="send-btn" disabled={!inputText.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
