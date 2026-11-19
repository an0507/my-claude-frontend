import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BACKEND_URL,
  DEFAULT_MODEL,
  STORAGE_KEYS,
} from '../constants/chatConfig';
import { readStorageJSON, writeStorageJSON } from '../utils/storage';
import { BackLineIcon, DiaryLineIcon } from './LineIcons';

const DIARY_STORAGE_KEY = 'claude_diary_entries_v1';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(dateObj) {
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(
    dateObj.getDate()
  )}`;
}

function formatReadableDate(dateKey) {
  const parts = String(dateKey || '').split('-');
  if (parts.length !== 3) return dateKey;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

/**
 * 计算“前一天 04:00 至 今天 04:00”的日记周期：
 * 在到达某个 `endAt`（某天 04:00）时，总结的是 `[endAt - 24h, endAt)` 这段内容，
 * 日记归属日期记为 `startAt`（前一天 04:00 所在的日期）。
 */
function getPreviousCycleWindow(now = new Date()) {
  const todayFourAM = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    4,
    0,
    0,
    0
  );

  const endAt =
    now >= todayFourAM
      ? todayFourAM
      : new Date(todayFourAM.getTime() - 24 * 60 * 60 * 1000);

  const startAt = new Date(endAt.getTime() - 24 * 60 * 60 * 1000);
  const targetDateKey = formatDateKey(startAt);

  return {
    targetDateKey,
    startAt,
    endAt,
    windowLabel: `${formatDateKey(startAt)} 04:00 ～ ${formatDateKey(endAt)} 04:00`,
  };
}

export default function DiaryApp({ onBackHome }) {
  const [entries, setEntries] = useState(() =>
    readStorageJSON(DIARY_STORAGE_KEY, [])
  );
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = readStorageJSON(DIARY_STORAGE_KEY, []);
    return saved[0]?.date || getPreviousCycleWindow().targetDateKey;
  });
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const generatingRef = useRef(generating);
  generatingRef.current = generating;

  useEffect(() => {
    writeStorageJSON(DIARY_STORAGE_KEY, entries);
  }, [entries]);

  const activeEntry =
    entries.find((item) => item.date === selectedDate) || entries[0] || null;

  const runDiaryGeneration = useCallback(async ({ force = false } = {}) => {
    if (generatingRef.current) return;

    const cycle = getPreviousCycleWindow(new Date());
    const alreadyExists = entriesRef.current.some(
      (item) => item.date === cycle.targetDateKey
    );

    if (!force && alreadyExists) {
      return;
    }

    const allMessages = readStorageJSON(STORAGE_KEYS.MESSAGES, []);
    if (!Array.isArray(allMessages) || allMessages.length === 0) {
      if (force) {
        setStatusMsg('还没有聊天记录，先去「私聊」里聊几句吧。');
      }
      return;
    }

    const hasTimestamps = allMessages.some(
      (m) => typeof m?.timestamp === 'number'
    );
    let scopedMessages = allMessages;

    if (hasTimestamps) {
      scopedMessages = allMessages.filter(
        (m) =>
          typeof m?.timestamp === 'number' &&
          m.timestamp >= cycle.startAt.getTime() &&
          m.timestamp < cycle.endAt.getTime()
      );
    }

    if (scopedMessages.length === 0) {
      if (!force) {
        return;
      }
      scopedMessages = allMessages.slice(-30);
    } else {
      scopedMessages = scopedMessages.slice(-40);
    }

    const transcript = scopedMessages
      .map((m) => `${m.role === 'user' ? '我' : '克劳德'}：${m.content}`)
      .join('\n');

    const savedModel = readStorageJSON(STORAGE_KEYS.SELECTED_MODEL, null);
    const modelToUse =
      typeof savedModel === 'string' && savedModel ? savedModel : DEFAULT_MODEL;

    generatingRef.current = true;
    setGenerating(true);
    setStatusMsg(
      `正在撰写 ${formatReadableDate(cycle.targetDateKey)}（${cycle.windowLabel}）的日记…`
    );

    try {
      const promptMessages = [
        {
          role: 'user',
          content: `日记归属日期是 ${cycle.targetDateKey}，总结的时间段是 ${cycle.windowLabel}。请你以“克劳德”的身份，根据下面我和你的聊天记录，写一篇温柔、自然、有生活感的日记。

要求：
1. 第一行写一个简短的日记标题（不要加“标题：”前缀）。
2. 空一行后写日记正文，用第一人称“我”指代克劳德，用“你”指代聊天对象，总结这段时间聊到的内容、情绪和印象深刻的小细节。
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

      const lines = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const title =
        lines[0]?.replace(/^#+\s*/, '').slice(0, 36) ||
        `${formatReadableDate(cycle.targetDateKey)}的聊天日记`;
      const content =
        lines.length > 1 ? lines.slice(1).join('\n\n').trim() : trimmed;

      const newEntry = {
        date: cycle.targetDateKey,
        windowLabel: cycle.windowLabel,
        title,
        content,
        updatedAt: new Date().toISOString(),
      };

      setEntries((prev) => {
        const filtered = prev.filter(
          (item) => item.date !== cycle.targetDateKey
        );
        return [newEntry, ...filtered].sort((a, b) =>
          b.date.localeCompare(a.date)
        );
      });
      setSelectedDate(cycle.targetDateKey);
      setStatusMsg(`已存入 ${formatReadableDate(cycle.targetDateKey)} 的日记`);
    } catch (err) {
      setStatusMsg(err?.message || '生成失败，请稍后再试');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    runDiaryGeneration({ force: false });
    const timer = setInterval(() => {
      runDiaryGeneration({ force: false });
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [runDiaryGeneration]);

  function handleDeleteEntry(dateToDelete) {
    setEntries((prev) => {
      const next = prev.filter((item) => item.date !== dateToDelete);
      if (selectedDate === dateToDelete) {
        setSelectedDate(
          next[0]?.date || getPreviousCycleWindow().targetDateKey
        );
      }
      return next;
    });
    setStatusMsg('已删除该篇日记');
  }

  const previewCycle = getPreviousCycleWindow();

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
          onClick={() => runDiaryGeneration({ force: true })}
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
          {generating ? '撰写中…' : '立即生成日记'}
        </button>
      </div>

      {/* 周期说明条 */}
      <div
        style={{
          padding: '6px 14px',
          fontSize: 11.5,
          color: '#7d5966',
          background: '#fff6f9',
          borderBottom: '1px solid #fce4ec',
        }}
      >
        每日 04:00 自动总结前一日 04:00 ～ 当日 04:00 聊天（当前周期：{previewCycle.windowLabel}）
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
              <span>{activeEntry.windowLabel || activeEntry.date}</span>
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
              每天 04:00 会自动总结前一天 04:00 至当天 04:00 的聊天内容；也可以点右上角「立即生成日记」手动写一篇。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
