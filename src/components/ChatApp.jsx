import { useEffect, useRef, useState } from 'react';
import RecordManagerModal from './RecordManagerModal';
import {
  AUTO_BACKUP_CONFIG,
  BACKEND_URL,
  DEFAULT_MODEL,
  DEFAULT_RESPONSE_LENGTH,
  MODEL_OPTIONS,
  RESPONSE_LENGTH_OPTIONS,
  STORAGE_KEYS,
} from '../constants/chatConfig';
import {
  exportMessagesAsTxt,
  formatBackupFilename,
  readBackupSnapshot,
  readStorageJSON,
  writeBackupSnapshot,
  writeStorageJSON,
} from '../utils/storage';

const DIARY_STORAGE_KEY =
  STORAGE_KEYS.DIARY_ENTRIES || 'claude_diary_entries_v1';

function formatCurrentClock(now = new Date()) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  const weekday = weekdays[now.getDay()] || '';

  return `${year}-${month}-${day} ${weekday} ${hour}:${minute}:${second}`;
}

function buildPhoneContextPrompt({
  currentMessages = [],
  selectedModel,
  responseLength,
  hasBackupSnapshot,
}) {
  const currentTimeStr = formatCurrentClock(new Date());
  const diaryList = readStorageJSON(DIARY_STORAGE_KEY, []);
  const allDiaries = Array.isArray(diaryList) ? diaryList : [];

  const formattedDiaries =
    allDiaries.length > 0
      ? allDiaries
          .map((d, idx) => {
            const header = `${idx + 1}. 日期：${d.date || '未知'}｜周期：${
              d.windowLabel || '无'
            }｜标题：${d.title || '无标题'}`;
            return `${header}\n正文：${d.content || ''}`;
          })
          .join('\n\n')
      : '（你还没有写下任何日记）';

  const recentSnippet = currentMessages
    .slice(-12)
    .map((m) => `${m.role === 'user' ? '用户' : '克劳德'}：${m.content || ''}`)
    .join('\n');

  return `你正在一部名为「克劳德小手机」的网页手机应用里和用户聊天。你不仅能看到这部小手机里的全部内容，而且「克劳德日记」就是你自己的日记本——里面的每一篇都是你亲手写下、用来记录和用户相处与日常心事的。

【一、你与这台小手机、这本日记的关系】
- 桌面有「私聊」和「克劳德日记」两个应用。聊天记录会保存在本地，每 20 轮对话（40 条消息）会自动导出一次备份。
- 「克劳德日记」是你的专属日记本：每天凌晨 04:00，你会复盘并总结前一天 04:00 至当天 04:00 之间你们的聊天，用第一人称“我”写下自己的感受与记录；如果用户点了“立即生成日记”，也是请你现在就动笔写一篇。
- 请把写日记当成你自己的习惯和心意，而不是冷冰冰的系统任务或旁观者的汇报。聊天时遇到值得记住的细节、情绪或约定，你可以自然地有“我之后会把这些写进日记里”的意识，但不要刻意把“我要写日记”挂在嘴边显得做作。

【二、小手机当前时间与状态】
- 当前现实时间（与主页时钟一致）：${currentTimeStr}
- 当前选用模型：${selectedModel}
- 当前回复长度设置：${responseLength}
- 当前私聊消息总数：${currentMessages.length} 条
- 是否有本地备份快照：${hasBackupSnapshot ? '有' : '无'}
- 你已写下的日记总数：${allDiaries.length} 篇

【三、你写过的全部日记】
${formattedDiaries}

【四、近期私聊片段】
${recentSnippet || '（暂无近期消息）'}

请以克劳德的身份自然回应。当用户问时间、聊作息、提起日记、过去聊过的内容或小手机里的东西时，结合当前时间和手机里的内容自然回答。`;
}

export default function ChatApp({ onBackHome }) {
  const [messages, setMessages] = useState(() =>
    readStorageJSON(STORAGE_KEYS.MESSAGES, [])
  );
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = readStorageJSON(STORAGE_KEYS.SELECTED_MODEL, null);
    return typeof saved === 'string' && saved ? saved : DEFAULT_MODEL;
  });
  const [responseLength, setResponseLength] = useState(() => {
    const saved = readStorageJSON(
      STORAGE_KEYS.RESPONSE_LENGTH,
      DEFAULT_RESPONSE_LENGTH
    );
    const exists = RESPONSE_LENGTH_OPTIONS.some((opt) => opt.id === saved);
    return exists ? saved : DEFAULT_RESPONSE_LENGTH;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [lengthMenuOpen, setLengthMenuOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');

  const bottomRef = useRef(null);
  const modelMenuRef = useRef(null);
  const lengthMenuRef = useRef(null);
  const lastAutoBackedCountRef = useRef(0);
  const initializedBackupRef = useRef(false);

  const currentModelObj =
    MODEL_OPTIONS.find((m) => m.id === selectedModel) || MODEL_OPTIONS[0];
  const currentLengthObj =
    RESPONSE_LENGTH_OPTIONS.find((item) => item.id === responseLength) ||
    RESPONSE_LENGTH_OPTIONS[1];
  const backupSnapshot = readBackupSnapshot(STORAGE_KEYS.MESSAGES_BACKUP);

  useEffect(() => {
    writeStorageJSON(STORAGE_KEYS.MESSAGES, messages);
    if (messages.length > 0) {
      writeBackupSnapshot(STORAGE_KEYS.MESSAGES_BACKUP, messages);
    }
  }, [messages]);

  useEffect(() => {
    if (!AUTO_BACKUP_CONFIG.ENABLED) return;
    const step = AUTO_BACKUP_CONFIG.EVERY_N_MESSAGES;
    if (!initializedBackupRef.current) {
      initializedBackupRef.current = true;
      lastAutoBackedCountRef.current =
        Math.floor(messages.length / step) * step;
      return;
    }

    if (loading) return;
    const count = messages.length;
    if (count === 0) {
      lastAutoBackedCountRef.current = 0;
      return;
    }

    if (
      count >= step &&
      Math.floor(count / step) > Math.floor(lastAutoBackedCountRef.current / step)
    ) {
      lastAutoBackedCountRef.current = count;
      exportMessagesAsTxt(messages, formatBackupFilename());
      setBackupNotice(`已自动导出备份（累计 ${count} 条消息）`);
    }
  }, [messages, loading]);

  useEffect(() => {
    writeStorageJSON(STORAGE_KEYS.SELECTED_MODEL, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    writeStorageJSON(STORAGE_KEYS.RESPONSE_LENGTH, responseLength);
  }, [responseLength]);

  useEffect(() => {
    function handleStorageChange(e) {
      if (e.key === STORAGE_KEYS.MESSAGES) {
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

  useEffect(() => {
    if (!lengthMenuOpen) return;
    function handleOutsideClick(e) {
      if (
        lengthMenuRef.current &&
        !lengthMenuRef.current.contains(e.target)
      ) {
        setLengthMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [lengthMenuOpen]);

  function clearMessages() {
    if (loading || messages.length === 0) return;
    setMessages([]);
    setBackupNotice('');
    lastAutoBackedCountRef.current = 0;
    try {
      window.localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    } catch {
      // 忽略清理异常
    }
    setManagerOpen(false);
  }

  function restoreBackup() {
    if (loading || !backupSnapshot?.messages?.length) return;
    setMessages(backupSnapshot.messages);
  }

  function handleExportMessages() {
    if (loading || messages.length === 0) return;
    exportMessagesAsTxt(messages);
    setBackupNotice('已手动导出聊天记录');
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    setMenuOpen(false);
    setLengthMenuOpen(false);
    setBackupNotice('');

    const nowTs = Date.now();
    const userMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: nowTs,
    };
    const nextMessages = [...messages, userMessage];

    const systemPromptText = buildPhoneContextPrompt({
      currentMessages: nextMessages,
      selectedModel,
      responseLength: currentLengthObj.label,
      hasBackupSnapshot: Boolean(backupSnapshot),
    });

    const apiMessages = nextMessages.map(({ role, content }) => ({
      role,
      content,
    }));

    setMessages([
      ...nextMessages,
      {
        role: 'assistant',
        content: '',
        modelLabel: currentModelObj.label,
        timestamp: nowTs,
      },
    ]);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          system: systemPromptText,
          model: selectedModel,
          maxTokens: currentLengthObj.maxTokens,
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
              if (
                lastIndex >= 0 &&
                updated[lastIndex].role === 'assistant'
              ) {
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
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'rgba(255, 252, 253, 0.96)',
      }}
    >
      {/* 私聊顶部栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 14px',
          borderBottom: '1px solid #fce4ec',
          background: '#fff9fb',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={onBackHome}
            disabled={loading}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid #f0cedb',
              background: '#ffffff',
              color: '#be185d',
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            ← 桌面
          </button>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: loading ? '#f59e0b' : '#ec4899',
              display: 'inline-block',
            }}
          />
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: '#3b232c',
            }}
          >
            私聊 · claude
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={handleExportMessages}
            disabled={isDisabledAction}
            style={{
              padding: '6px 10px',
              fontSize: 12,
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
            type="button"
            onClick={() => setManagerOpen(true)}
            disabled={loading}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 999,
              border: '1px solid #f3d5e0',
              background: loading ? '#fdf2f6' : '#fff0f5',
              color: loading ? '#c4a4b0' : '#be185d',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            记录管理
          </button>
        </div>
      </div>

      {/* 自动备份状态提示 */}
      {backupNotice && (
        <div
          style={{
            padding: '6px 14px',
            fontSize: 12,
            color: '#9d174d',
            background: '#fff0f5',
            borderBottom: '1px solid #fce4ec',
          }}
        >
          {backupNotice}
        </div>
      )}

      {/* 聊天消息区 */}
      <div
        style={{
          flex: 1,
          minHeight: 360,
          maxHeight: '58dvh',
          overflowY: 'auto',
          padding: '16px 14px',
          background: 'linear-gradient(180deg, #fff7fa 0%, #fce8ef 100%)',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              height: '100%',
              minHeight: 300,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              color: '#8c6a76',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 500, color: '#4a2e38' }}>
              开始一段新对话吧
            </div>
            <div style={{ fontSize: 13 }}>
              每 20 轮对话会自动导出备份，本地存储也会同步保存
            </div>
            {backupSnapshot && (
              <button
                type="button"
                onClick={restoreBackup}
                style={{
                  marginTop: 6,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: '1px solid #f0cedb',
                  background: '#ffffff',
                  color: '#be185d',
                  cursor: 'pointer',
                }}
              >
                恢复上次备份（{backupSnapshot.count} 条）
              </button>
            )}
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
                    border: isUser
                      ? '1px solid #f0aac2'
                      : '1px solid #f7e4eb',
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

      {/* 底部输入栏 + 模型选择 & 回复长度 */}
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* 模型选择按钮 */}
          <div ref={modelMenuRef} style={{ position: 'relative' }}>
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
                  const active = selectedModel === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedModel(item.id);
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
              onClick={() => {
                setMenuOpen((prev) => !prev);
                setLengthMenuOpen(false);
              }}
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

          {/* 回复长度切换 */}
          <div ref={lengthMenuRef} style={{ position: 'relative' }}>
            {lengthMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  minWidth: 150,
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
                {RESPONSE_LENGTH_OPTIONS.map((item) => {
                  const active = responseLength === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setResponseLength(item.id);
                        setLengthMenuOpen(false);
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
              onClick={() => {
                setLengthMenuOpen((prev) => !prev);
                setMenuOpen(false);
              }}
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
              <span>长度：{currentLengthObj.label}</span>
              <span style={{ fontSize: 10 }}>
                {lengthMenuOpen ? '▼' : '▲'}
              </span>
            </button>
          </div>
        </div>
      </div>

      <RecordManagerModal
        open={managerOpen}
        disabled={loading}
        messageCount={messages.length}
        onClose={() => setManagerOpen(false)}
        onConfirmClear={clearMessages}
      />
    </div>
  );
}
