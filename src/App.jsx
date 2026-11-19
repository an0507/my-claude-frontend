import { useEffect, useRef, useState } from 'react';

const BACKEND_URL = 'https://my-claude-backend.onrender.com';
const STORAGE_KEY = 'my_claude_chat_messages_v1';
const MODEL_STORAGE_KEY = 'my_claude_selected_model_v1';

const MODEL_OPTIONS = [
  { label: 'f5.2', fullName: 'Claude Fable 5.2', value: 'claude-fable-5-2' },
  { label: 'o5.5', fullName: 'Claude Opus 5.5', value: 'claude-opus-5-5' },
  { label: 'f5.1', fullName: 'Claude Fable 5.1', value: 'claude-fable-5-1' },
  { label: 'f5', fullName: 'Claude Fable 5', value: 'claude-fable-5' },
  { label: 'o5', fullName: 'Claude Opus 5', value: 'claude-opus-5' },
  { label: 'o4.6', fullName: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const modelMenuRef = useRef(null);

  const currentModelObj =
    MODEL_OPTIONS.find((m) => m.value === selectedModel) || MODEL_OPTIONS[0];

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

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutsideClick(e) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [menuOpen]);

  function clearMessages() {
    if (loading || messages.length === 0) return;
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  function exportMessages() {
    if (loading || messages.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const lines = [
      'claude 聊天记录导出',
      `导出时间：${now.toLocaleString()}`,
      '====================================',
      '',
    ];

    messages.forEach((m) => {
      const isUser = m.role === 'user';
      const speaker = isUser
        ? '[我]'
        : m.modelLabel
          ? `[claude · ${m.modelLabel}]`
          : '[claude]';
      lines.push(speaker);
      lines.push(m.content || '');
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `claude-chat-${dateStr}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    setMenuOpen(false);
    const userMessage = { role: 'user', content: input.trim() };
    const nextMessages = [...messages, userMessage];

    setMessages([
      ...nextMessages,
      { role: 'assistant', content: '', modelLabel: currentModelObj.label },
    ]);
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

  const isDisabledAction = loading || messages.length === 0;

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
          overflow: 'visible',
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
            borderRadius: '20px 20px 0 0',
            gap: 8,
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={exportMessages}
              disabled={isDisabledAction}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 999,
                border: '1px solid #f0cedb',
                background: isDisabledAction ? '#fdf2f6' : '#ffffff',
                color: isDisabledAction ? '#c4a4b0' : '#6e4d59',
                cursor: isDisabledAction ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              导出记录
            </button>

            <button
              onClick={clearMessages}
              disabled={isDisabledAction}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 999,
                border: '1px solid #f3d5e0',
                background: isDisabledAction ? '#fdf2f6' : '#fff0f5',
                color: isDisabledAction ? '#c4a4b0' : '#be185d',
                cursor: isDisabledAction ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              清空记录
            </button>
          </div>
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
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
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

                  {!isUser && m.modelLabel && (
                    <span
                      style={{
                        marginTop: 4,
                        paddingLeft: 4,
                        fontSize: 11,
                        color: '#9a7b86',
                      }}
                    >
                      {m.modelLabel}
                    </span>
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* 底部输入栏 + 下方单个模型选择按钮 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            borderTop: '1px solid #fce4ec',
            background: '#fff9fb',
            borderRadius: '0 0 20px 20px',
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

          <div ref={modelMenuRef} style={{ position: 'relative', alignSelf: 'flex-start' }}>
            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  minWidth: 190,
                  background: '#ffffff',
                  border: '1px solid #f0cedb',
                  borderRadius: 14,
                  boxShadow: '0 10px 25px rgba(219, 112, 147, 0.18)',
                  padding: 6,
                  zIndex: 30,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {MODEL_OPTIONS.map((item) => {
                  const active = selectedModel === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        setSelectedModel(item.value);
                        setMenuOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: 'none',
                        background: active ? '#ffe8f0' : 'transparent',
                        color: active ? '#be185d' : '#3b232c',
                        fontWeight: active ? 600 : 400,
                        fontSize: 13,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span>{item.label}</span>
                      <span style={{ fontSize: 11, color: '#9a7b86' }}>
                        {active ? '✓' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={() => setMenuOpen((prev) => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
                border: '1px solid #f0cedb',
                background: '#ffffff',
                color: '#6e4d59',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              <span>模型：{currentModelObj.label}</span>
              <span style={{ fontSize: 10 }}>{menuOpen ? '▼' : '▲'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
