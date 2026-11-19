import { useEffect, useState } from 'react';

const BACKEND_URL = 'https://my-claude-backend.onrender.com';
const STORAGE_KEY = 'my_claude_chat_messages_v1';

function App() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // 每次 messages 变化时，自动保存到浏览器本地
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // 忽略存储空间超限等异常
    }
  }, [messages]);
  // 监听其他标签页对聊天记录的修改，实现多标签页同步
  useEffect(() => {
    function handleStorageChange(e) {
      if (e.key === STORAGE_KEY) {
        try {
          setMessages(e.newValue ? JSON.parse(e.newValue) : []);
        } catch {
          // 忽略解析异常
        }
      }
    }

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  function clearMessages() {
    if (loading) return;
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input };
    const nextMessages = [...messages, userMessage];

    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error('网络响应异常');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;

          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') break;

          const parsed = JSON.parse(dataStr);
          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.text) {
            setMessages((prev) => {
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
                updated[lastIndex] = {
                  ...updated[lastIndex],
                  content: updated[lastIndex].content + parsed.text,
                };
              }
              return updated;
            });
          }
        }
      }
    } catch (e) {
      alert(e.message || '出错了，请稍后重试');
      setMessages(nextMessages);
    }

    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>跟Claude聊天</h2>
        <button onClick={clearMessages} disabled={loading || messages.length === 0}>
          清空记录
        </button>
      </div>

      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 16,
          minHeight: 300,
          marginTop: 12,
          marginBottom: 16,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 10,
              textAlign: m.role === 'user' ? 'right' : 'left',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '8px 12px',
                borderRadius: 8,
                background: m.role === 'user' ? '#DCF8C6' : '#f1f1f1',
                maxWidth: '80%',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content || (m.role === 'assistant' && loading ? 'Claude正在输入…' : '')}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, padding: 8, fontSize: 14 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="输入消息…"
        />
        <button onClick={sendMessage} disabled={loading}>
          发送
        </button>
      </div>
    </div>
  );
}

export default App;
