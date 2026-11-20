import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BACKEND_URL,
  DEFAULT_MODEL,
  STORAGE_KEYS,
} from '../constants/chatConfig';
import { readStorageJSON, writeStorageJSON } from '../utils/storage';
import { BackLineIcon, DiaryLineIcon } from './LineIcons';

const DIARY_STORAGE_KEY =
  STORAGE_KEYS.DIARY_ENTRIES || 'claude_diary_entries_v1';
const DIARY_SUMMARIES_KEY = 'claude_diary_memory_summaries_v1';
const BATCH_SIZE = 5;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(dateObj) {
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(
    dateObj.getDate()
  )}`;
}

function formatNowStamp(now = new Date()) {
  return `${formatDateKey(now)} ${pad2(now.getHours())}:${pad2(
    now.getMinutes()
  )}`;
}

function formatReadableDate(dateKey) {
  const parts = String(dateKey || '').split('-');
  if (parts.length !== 3) return dateKey;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

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

function sortChronological(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || ''))
  );
}

function formatCommentsForPrompt(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return '';
  const lines = comments.map(
    (c) => `  - [${c.time || ''}] 晓菲：${c.text || ''}`
  );
  return `\n日记下方留言：\n${lines.join('\n')}`;
}

async function fetchStreamText(payload) {
  const resp = await fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok || !resp.body) {
    throw new Error('网络响应异常');
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

  return fullText.trim();
}

export default function DiaryApp({ onBackHome }) {
  const [entries, setEntries] = useState(() =>
    readStorageJSON(DIARY_STORAGE_KEY, [])
  );
  const [summaries, setSummaries] = useState(() =>
    readStorageJSON(DIARY_SUMMARIES_KEY, [])
  );
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = readStorageJSON(DIARY_STORAGE_KEY, []);
    return saved[0]?.date || getPreviousCycleWindow().targetDateKey;
  });
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [commentDraft, setCommentDraft] = useState('');

  const busyRef = useRef(false);
  busyRef.current = generating;

  useEffect(() => {
    writeStorageJSON(DIARY_STORAGE_KEY, entries);
  }, [entries]);

  useEffect(() => {
    writeStorageJSON(DIARY_SUMMARIES_KEY, summaries);
  }, [summaries]);

  useEffect(() => {
    setCommentDraft('');
  }, [selectedDate]);

  const activeEntry =
    entries.find((item) => item.date === selectedDate) || entries[0] || null;

  const syncBatchSummaries = useCallback(async (allEntries, currentSummaries, modelToUse) => {
    const chrono = sortChronological(allEntries);
    const completedBatchCount = Math.floor(chrono.length / BATCH_SIZE);

    const validSummaries = (Array.isArray(currentSummaries) ? currentSummaries : [])
      .filter((s) => typeof s.batchIndex === 'number' && s.batchIndex <= completedBatchCount)
      .sort((a, b) => a.batchIndex - b.batchIndex);

    if (completedBatchCount === 0) {
      return [];
    }

    let updatedSummaries = [...validSummaries];

    for (let batchIdx = 1; batchIdx <= completedBatchCount; batchIdx += 1) {
      const start = (batchIdx - 1) * BATCH_SIZE;
      const batchSlice = chrono.slice(start, start + BATCH_SIZE);
      const startDate = batchSlice[0]?.date || '';
      const endDate = batchSlice[batchSlice.length - 1]?.date || '';
      const rangeLabel = `第${batchIdx}批（${startDate} ～ ${endDate}）`;

      const exists = updatedSummaries.some(
        (item) =>
          item.batchIndex === batchIdx &&
          item.startDate === startDate &&
          item.endDate === endDate
      );
      if (exists) continue;

      setStatusMsg(`日记已满 ${batchIdx * BATCH_SIZE} 篇，正在生成${rangeLabel}摘要…`);

      const batchText = batchSlice
        .map(
          (d, idx) =>
            `第${start + idx + 1}篇（${d.date}｜${d.title || '无标题'}）：\n${d.content || ''}${formatCommentsForPrompt(d.comments)}`
        )
        .join('\n\n');

      const summaryText = await fetchStreamText({
        messages: [
          {
            role: 'user',
            content: `请将下面这 ${BATCH_SIZE} 篇日记合并概括成 1 篇精简摘要（控制在 150~250 字左右）。
要求：保留核心事件、情绪变化、重要约定和人物/日常细节，用客观简洁的中文连贯写出，不要分点编号，也不要加“摘要：”前缀。

${batchText}`,
          },
        ],
        model: modelToUse,
        maxTokens: 500,
      });

      if (summaryText) {
        const nextItem = {
          batchIndex: batchIdx,
          startDate,
          endDate,
          rangeLabel,
          summary: summaryText,
          updatedAt: new Date().toISOString(),
        };
        updatedSummaries = [
          ...updatedSummaries.filter((item) => item.batchIndex !== batchIdx),
          nextItem,
        ].sort((a, b) => a.batchIndex - b.batchIndex);
      }
    }

    return updatedSummaries;
  }, []);

  const handleGenerateDiary = useCallback(async () => {
    if (busyRef.current) return;

    const now = new Date();
    const cycle = getPreviousCycleWindow(now);

    const allMessages = readStorageJSON(STORAGE_KEYS.MESSAGES, []);
    if (!Array.isArray(allMessages) || allMessages.length === 0) {
      setStatusMsg('还没有聊天记录，先去「私聊」里聊几句吧。');
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

    busyRef.current = true;
    setGenerating(true);
    setStatusMsg(
      `正在撰写 ${formatReadableDate(cycle.targetDateKey)}（${cycle.windowLabel}）的日记…`
    );

    try {
      const trimmed = await fetchStreamText({
        messages: [
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
        ],
        model: modelToUse,
        maxTokens: 900,
      });

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

      const existingSameDay = entries.find(
        (item) => item.date === cycle.targetDateKey
      );

      const newEntry = {
        date: cycle.targetDateKey,
        windowLabel: cycle.windowLabel,
        title,
        content,
        comments: Array.isArray(existingSameDay?.comments)
          ? existingSameDay.comments
          : [],
        updatedAt: new Date().toISOString(),
      };

      const mergedEntries = [
        newEntry,
        ...entries.filter((item) => item.date !== cycle.targetDateKey),
      ].sort((a, b) => b.date.localeCompare(a.date));

      setEntries(mergedEntries);
      setSelectedDate(cycle.targetDateKey);

      const syncedSummaries = await syncBatchSummaries(
        mergedEntries,
        summaries,
        modelToUse
      );
      setSummaries(syncedSummaries);

      setStatusMsg(
        `已存入 ${formatReadableDate(cycle.targetDateKey)} 的日记（当前共 ${mergedEntries.length} 篇，已生成 ${syncedSummaries.length} 篇摘要）`
      );
    } catch (err) {
      setStatusMsg(err?.message || '生成失败，请稍后再试');
    } finally {
      busyRef.current = false;
      setGenerating(false);
    }
  }, [entries, summaries, syncBatchSummaries]);

  function handleAddComment(e) {
    e.preventDefault();
    if (!activeEntry) return;
    const text = commentDraft.trim();
    if (!text) return;

    const newComment = {
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: formatNowStamp(new Date()),
      text,
    };

    setEntries((prev) =>
      prev.map((item) => {
        if (item.date !== activeEntry.date) return item;
        const oldComments = Array.isArray(item.comments) ? item.comments : [];
        return {
          ...item,
          comments: [...oldComments, newComment],
        };
      })
    );
    setCommentDraft('');
    setStatusMsg('已留下日记批注');
  }

  function handleDeleteComment(commentId) {
    if (!activeEntry) return;
    setEntries((prev) =>
      prev.map((item) => {
        if (item.date !== activeEntry.date) return item;
        const oldComments = Array.isArray(item.comments) ? item.comments : [];
        return {
          ...item,
          comments: oldComments.filter((c) => c.id !== commentId),
        };
      })
    );
    setStatusMsg('已删除该条留言');
  }

  function handleDeleteEntry(dateToDelete) {
    const nextEntries = entries.filter((item) => item.date !== dateToDelete);
    const completedBatchCount = Math.floor(nextEntries.length / BATCH_SIZE);
    const nextSummaries = summaries
      .filter((s) => typeof s.batchIndex === 'number' && s.batchIndex <= completedBatchCount)
      .sort((a, b) => a.batchIndex - b.batchIndex);

    setEntries(nextEntries);
    setSummaries(nextSummaries);
    if (selectedDate === dateToDelete) {
      setSelectedDate(
        nextEntries[0]?.date || getPreviousCycleWindow().targetDateKey
      );
    }
    setStatusMsg('已删除该篇日记');
  }

  const previewCycle = getPreviousCycleWindow();
  const activeComments = Array.isArray(activeEntry?.comments)
    ? activeEntry.comments
    : [];

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
          onClick={handleGenerateDiary}
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

      <div
        style={{
          padding: '6px 14px',
          fontSize: 11.5,
          color: '#7d5966',
          background: '#fff6f9',
          borderBottom: '1px solid #fce4ec',
        }}
      >
        每满 {BATCH_SIZE} 篇生成 1 篇摘要（当前 {entries.length} 篇日记 /{' '}
        {summaries.length} 篇摘要）
      </div>

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

            {/* 日记下方留言区 */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px dashed #f2cedb',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#8c6a76',
                  marginBottom: 8,
                }}
              >
                日记留言（{activeComments.length}）
              </div>

              {activeComments.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    marginBottom: 10,
                  }}
                >
                  {activeComments.map((cmt) => (
                    <div
                      key={cmt.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '7px 10px',
                        borderRadius: 10,
                        background: '#fff7fa',
                        border: '1px solid #fce4ec',
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: '#3b232c',
                      }}
                    >
                      <div style={{ minWidth: 0, wordBreak: 'break-word' }}>
                        <span style={{ fontWeight: 600, color: '#be185d' }}>
                          晓菲
                        </span>
                        {cmt.time && (
                          <span
                            style={{
                              fontSize: 11,
                              color: '#9a7b86',
                              marginLeft: 6,
                            }}
                          >
                            {cmt.time}
                          </span>
                        )}
                        <span>：{cmt.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(cmt.id)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#b07b8e',
                          fontSize: 11.5,
                          cursor: 'pointer',
                          flexShrink: 0,
                          padding: 0,
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form
                onSubmit={handleAddComment}
                style={{ display: 'flex', gap: 8 }}
              >
                <input
                  type="text"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="在日记下面留句话或颜文字…"
                  style={{
                    flex: 1,
                    padding: '7px 11px',
                    fontSize: 13,
                    borderRadius: 10,
                    border: '1px solid #f0cedb',
                    background: '#fffdfd',
                    color: '#2d1e24',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={!commentDraft.trim()}
                  style={{
                    padding: '0 14px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    borderRadius: 10,
                    border: 'none',
                    background: commentDraft.trim() ? '#e57399' : '#f5c6d6',
                    color: '#ffffff',
                    cursor: commentDraft.trim() ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                  }}
                >
                  留言
                </button>
              </form>
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
              按 04:00 周期（当前周期：{previewCycle.windowLabel}）记录聊天内容；每满{' '}
              {BATCH_SIZE} 篇会自动生成 1 篇摘要。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
