import { useEffect, useState } from 'react';
import { BACKEND_URL, DEFAULT_MODEL, STORAGE_KEYS } from '../constants/chatConfig';
import { readStorageJSON, writeStorageJSON } from '../utils/storage';
import { BackLineIcon, DiaryLineIcon } from './LineIcons';

const DIARY_STORAGE_KEY = 'claude_diary_entries_v1';

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatReadableDate(dateKey) {
  const parts = String(dateKey || '').split('-');
  if (parts.length !== 3) return dateKey;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

export default function DiaryApp({ onBackHome }) {
  const [entries, setEntries] = useState(() =>
    readStorageJSON(DIARY_STORAGE_KEY, [])
  );
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = readStorageJSON(DIARY_STORAGE_KEY, []);
    return saved[0]?.date || getTodayKey();
  });
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    writeStorageJSON(DIARY_STORAGE_KEY, entries);
  }, [entries]);

  const todayKey = getTodayKey();
  const activeEntry =
    entries.find((item) => item.date === selectedDate) || entries[0] || null;

  async function handleGenerateTodayDiary() {
    if (generating) return;
    setStatusMsg('');

    const allMessages = readStorageJSON(STORAGE_KEYS.MESSAGES, []);
    if (!Array.isArray(allMessages) || allMessages.length === 0) {
      setStatusMsg('还没有聊天记录，先去「私聊」里聊几句吧。');
      return;
    }

    // 取最近最多 30 条对话作为总结素材，避免上下文过长
    const recentMessages = allMessages.slice(-30);
    const transcript = recentMessages
      .map((m) => `${m.role === 'user' ? '我' : '克劳德'}：${m.content}`)
      .join('\n');

    const savedModel = readStorageJSON(STORAGE_KEYS.SELECTED_MODEL, null);
    const modelToUse =
      typeof savedModel === 'string' && savedModel ? savedModel : DEFAULT_MODEL;

    setGenerating(true);

    try {
      const promptMessages = [
        {
          role: 'user',
          content: `今天是 ${todayKey}。请你以“克劳德”的身份，根据下面我和你的聊天记录，为今天写一篇温柔、自然、有生活感的日记，存入我们的日记本。

要求：
1. 第一行写一个简短的日记标题（不要加“标题：”前缀）。
2. 空一行后写日记正文，用第一人称“我”指代克劳德，用“你”指代聊天对象，总结今天聊到的内容、情绪和印象深刻的小细节。
3. 控制在 180~350 字左右，不要列冰冷的要点清单。

聊天记录：
${transcript}`,
        },
      ];

      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: promptMessages,
          model: modelToUse,
          maxTokens: 900,
        }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error('生成日记时网络响应异常');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';

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
            fullText += parsed.text;
          }
        }
      }

      const trimmed = fullText.trim();
      if (!trimmed) {
        throw new Error('克劳德这次没有写出日记内容');
      }

      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
      const title =
        lines[0]?.replace(/^#+\s*/, '').slice(0, 36) ||
        `${formatReadableDate(todayKey)}的聊天日记`;
      const content =
        lines.length > 1 ? lines.slice(1).join('\n\n').trim() : trimmed;

      const newEntry = {
        date: todayKey,
        title,
        content,
        updatedAt: new Date().toISOString(),
      };

      setEntries((prev) => {
        const withoutToday = prev.filter((item) => item.date !== todayKey);
        return [newEntry, ...withoutToday];
      });
      setSelectedDate(todayKey);
      setStatusMsg(`已存入 ${formatReadableDate(todayKey)} 的日记`);
    } catch (err) {
      setStatusMsg(err?.message || '生成失败，请稍后再试');
    } finally {
      setGenerating(false);
    }
  }

  function handleDeleteEntry(dateToDelete) {
    setEntries((prev) => {
      const next = prev.filter((item) => item.date !== dateToDelete);
      if (selectedDate === dateToDelete) {
        setSelectedDate(next[0]?.date || todayKey);
      }
      return next;
    });
    setStatusMsg('已删除该篇日记');
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 460,
        background: '#fff9fb',
      }}
    >
      {/* 顶部栏 */}
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
            disabled={generating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid #f0cedb',
              background: '#ffffff',
              color: '#be185d',
              cursor: generating ? 'not-allowed' : 'pointer',
            }}
          >
            <BackLineIcon size={13} color="#be185d" />
            <span>桌面</span>
          </button>
          <DiaryLineIcon size={17} color="#be185d" />
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: '#3b232c',
            }}
          >
            克劳德日记
          </h2>
        </div>

        <button
          type="button"
          onClick={handleGenerateTodayDiary}
          disabled={generating}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 999,
            border: 'none',
            background: generating ? '#f5c6d6' : '#e57399',
            color: '#ffffff',
            cursor: generating ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {generating ? '撰写中…' : '总结今日日记'}
        </button>
      </div>

      {/* 状态提示 */}
      {statusMsg && (
        <div
          style={{
            padding: '8px 14px',
            fontSize: 12,
            color: '#9d174d',
            background: '#fff0f5',
            borderBottom: '1px solid #fce4ec',
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* 日期切换条 */}
      {entries.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 14px',
            overflowX: 'auto',
            borderBottom: '1px solid #fce4ec',
            background: '#fff6f9',
          }}
        >
          {entries.map((item) => {
            const active = activeEntry?.date === item.date;
            return (
              <button
                key={item.date}
                type="button"
                onClick={() => setSelectedDate(item.date)}
                style={{
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  borderRadius: 999,
                  border: active ? '1px solid #e57399' : '1px solid #f0cedb',
                  background: active ? '#ffe8f0' : '#ffffff',
                  color: active ? '#be185d' : '#6e4d59',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatReadableDate(item.date)}
              </button>
            );
          })}
        </div>
      )}

      {/* 日记阅读区 */}
      <div
        style={{
          flex: 1,
          padding: '18px 16px',
          background: 'linear-gradient(180deg, #fff7fa 0%, #fce8ef 100%)',
          overflowY: 'auto',
        }}
      >
        {activeEntry ? (
          <article
            style={{
              background: '#ffffff',
              borderRadius: 18,
              padding: '16px 16px',
              border: '1px solid #f5d5e2',
              boxShadow: '0 6px 18px rgba(219, 112, 147, 0.1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
                fontSize: 12,
                color: '#9a7b86',
              }}
            >
              <span>{activeEntry.date}</span>
              <button
                type="button"
                onClick={() => handleDeleteEntry(activeEntry.date)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#b07b8e',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                删除
              </button>
            </div>

            <h3
              style={{
                margin: '0 0 12px',
                fontSize: 17,
                fontWeight: 600,
                color: '#3b232c',
              }}
            >
              {activeEntry.title}
            </h3>

            <div
              style={{
                fontSize: 14.5,
                lineHeight: 1.75,
                color: '#2d1e24',
                whiteSpace: 'pre-wrap',
              }}
            >
              {activeEntry.content}
            </div>
          </article>
        ) : (
          <div
            style={{
              minHeight: 300,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              color: '#8c6a76',
              gap: 10,
              padding: '0 12px',
            }}
          >
            <DiaryLineIcon size={30} color="#d47a9a" />
            <div style={{ fontSize: 15, fontWeight: 500, color: '#4a2e38' }}>
              还没有克劳德日记
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              聊完天后点右上角「总结今日日记」，克劳德会把你们的对话总结成一篇日记存下来。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
