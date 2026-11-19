import { useEffect, useRef, useState } from 'react';

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
  const bottomRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // 忽略存储空间超限等异常
    }
  }, [messages]);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function clearMessages() {
    if (loading || messages.length === 0) return;
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input.trim() };
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
    <div
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(180deg, #f6f7fb 0%, #eef1f7 100%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        color: '#1f2937',
        display: 'flex',
        justifyContent: 'center',
        padding: '16px 12px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          background: '#ffffff',
          borderRadius: 20,
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          border: '1px solid rgba(15, 23, 42, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 顶部栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 18px',
            borderBottom: '1px solid #f0f2f5',
            background: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: loading ? '#f59e0b' : '#10b981',
                display: 'inline-block',
              }}
            />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>跟Claude聊天</h2>
          </div>

          <button
            onClick={clearMessages}
            disabled={loading || messages.length === 0}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              borderRadius: 999,
              border: '1px solid #e5e7eb',
              background: loading || messages.length === 0 ? '#f9fafb' : '#fff5f5',
              color: loading || messages.length === 0 ? '#9ca3af' : '#dc2626',
              cursor: loading || messages.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            清空记录
          </button>
        </div>

        {/* 聊天消息区 */}
        <div
          style={{
            flex: 1,
            minHeight: 380,
            maxHeight: '65dvh',
            overflowY: 'auto',
            padding: '18px 16px',
            background: '#fafbfd',
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                height: '100%',
                minHeight: 320,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                color: '#6b7280',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 28 }}>💬</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#374151' }}>
                开始一段新对话吧
              </div>
              <div style={{ fontSize: 13 }}>
                记录会自动保存在本地，多标签页也能同步
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: isUser
                        ? '16px 16px 4px 16px'
                        : '16px 16px 16px 4px',
                      background: isUser ? '#2563eb' : '#f1f5f9',
                      color: isUser ? '#ffffff' : '#111827',
                      maxWidth: '80%',
                      fontSize: 15,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      boxShadow: isUser
                        ? '0 4px 12px rgba(37, 99, 235, 0.18)'
                        : '0 1px 3px rgba(15, 23, 42, 0.04)',
                    }}
                  >
                    {m.content ||
                      (m.role === 'assistant' && loading ? (
                        <span style={{ color: '#6b7280', fontSize: 14 }}>
                          Claude正在输入…
                        </span>
                      ) : (
                        ''
                      ))}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* 底部输入栏 */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 14px',
            borderTop: '1px solid #f0f2f5',
            background: '#ffffff',
          }}
        >
          <input
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: 15,
              borderRadius: 12,
              border: '1px solid #d1d5db',
              outline: 'none',
              background: '#f9fafb',
              color: '#111827',
            }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="输入消息…"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            style={{
              padding: '0 18px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 12,
              border: 'none',
              background: loading || !input.trim() ? '#93c5fd' : '#2563eb',
              color: '#ffffff',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? '发送中' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
