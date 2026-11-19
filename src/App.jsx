import { useState } from 'react';

// 把下面这行换成你在Render上拿到的真实后端地址
const BACKEND_URL = 'https://my-claude-backend.onrender.com/';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim()) return;
    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await resp.json();
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      alert('出错了，请检查后端地址是否正确，或者稍后重试');
    }
    setLoading(false);
   }

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px'
      <h2>跟Claude聊天</h2>
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, minHeight: 300, margi
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'user' ? 'right' : 'left'
            <span style={{
              display: 'inline-block',
              padding: '8px 12px',
              borderRadius: 8,
              background: m.role === 'user' ? '#DCF8C6' : '#f1f1f1',
              maxWidth: '80%',
              textAlign: 'left',
            }}>
              {m.content}
            </span>
          </div>
        ))}
        {loading && <div style={{ color: '#999' }}>Claude正在输入…</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1, padding: 8, fontSize: 14 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="输入消息…"
          />
          <button onClick={sendMessage} disabled={loading}>发送</button>
        </div>
      </div>
    );
 }

export default App;
