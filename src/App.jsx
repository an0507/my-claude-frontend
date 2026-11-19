import { useEffect, useRef, useState } from 'react';

const BACKEND_URL = 'https://my-claude-backend.onrender.com';
const STORAGE_KEY = 'my_claude_chat_messages_v1';
const MODEL_STORAGE_KEY = 'my_claude_selected_model_v1';

// 你可以按自己账号可用的 Claude 模型名增减这里
const MODEL_OPTIONS = [
  { label: 'Sonnet 5', value: 'claude-sonnet-5' },
  { label: 'Sonnet 4.5', value: 'claude-sonnet-4-5' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5' },
];

function App() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY) || MODEL_OPTIONS[0].value;
    } catch {
      return MODEL_OPTIONS[0].value;
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
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
    } catch {
      // 忽略存储空间超限等异常
    }
  }, [selectedModel]);

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
        body: JSON.stringify({
          messages: nextMessages,
          model: selectedModel,
        }),
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
        background: 'linear-gradient(180deg, #fff5f8 0%, #fde4ec 100%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        color: '#2d1e24',
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
          background: 'rgba(255, 252, 253, 0.92)',
          borderRadius: 20,
          boxShadow: '0 10px 30px rgba(219, 112, 147, 0.14)',
          border: '1px solid #fad7e3',
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
            borderBottom: '1px solid #fce4ec',
            background: '#fff9fb',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: loading ? '#f59e0b' : '#ec4899',
                display: 'inline-block',
              }}
            />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#3b232c' }}>
              claude
            </h2>
          </div>

          <button
            onClick={clearMessages}
            disabled={loading || messages.length === 0}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              borderRadius: 999,
              border: '1px solid #f3d5e0',
              background: loading || messages.length === 0 ? '#fdf2f6' : '#fff0f5',
              color: loading || messages.length === 0 ? '#c4a4b0' : '#be185d',
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
            maxHeight: '62dvh',
            overflowY: 'auto',
            padding: '18px 16px',
            background: 'linear-gradient(180deg, #fff7fa 0%, #fce8ef 100%)',
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
                color: '#8c6a76',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 28 }}>🌸</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#4a2e38' }}>
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
                      background: isUser ? '#f7bfd2' : '#ffffff',
                      color: isUser ? '#3a1824' : '#261a1e',
                      maxWidth: '80%',
                      fontSize: 15,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      boxShadow: isUser
                        ? '0 3px 10px rgba(219, 112, 147, 0.18)'
                        : '0 2px 6px rgba(190, 120, 145, 0.1)',
                      border: isUser ? '1px solid #f0aac2' : '1px solid #f7e4eb',
                    }}
                  >
                    {m.content ||
                      (m.role === 'assistant' && loading ? (
                        <span style={{ color: '#9a7b86', fontSize: 14 }}>
                          claude正在输入…
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

        {/* 底部输入栏 + 下方切换模型按钮 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            borderTop: '1px solid #fce4ec',
            background: '#fff9fb',
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              style={{
                flex: 1,
                padding: '10px 14px',
                fontSize: 15,
                borderRadius: 12,
                border: '1px solid #f2cedb',
                outline: 'none',
                background: '#ffffff',
                color: '#2d1e24',
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
                background: loading || !input.trim() ? '#f5c6d6' : '#e57399',
                color: '#ffffff',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? '发送中' : '发送'}
            </button>
          </div>

          {/* 输入消息下方的模型切换按钮 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: '#8c6a76' }}>模型：</span>
            {MODEL_OPTIONS.map((item) => {
              const active = selectedModel === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={loading}
                  onClick={() => setSelectedModel(item.value)}
                  style={{
                    padding: '4px 11px',
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    borderRadius: 999,
                    border: active ? '1px solid #e57399' : '1px solid #f0d2dd',
                    background: active ? '#e57399' : '#ffffff',
                    color: active ? '#ffffff' : '#6e4d59',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
