import { useCallback, useEffect, useState } from 'react';
import { readStorageJSON, writeStorageJSON } from '../utils/storage';
import {
  DIARY_BATCH_SIZE,
  DIARY_STORAGE_KEY,
  DIARY_SUMMARIES_KEY,
  getPreviousCycleWindow,
  syncDiaryBatchSummaries,
  useAutoDiaryScheduler,
} from '../hooks/useAutoDiaryScheduler';
import { BackLineIcon, DiaryLineIcon } from './LineIcons';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatNowStamp(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
    now.getDate()
  )} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
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

  useEffect(() => {
    writeStorageJSON(DIARY_STORAGE_KEY, entries);
  }, [entries]);

  useEffect(() => {
    writeStorageJSON(DIARY_SUMMARIES_KEY, summaries);
  }, [summaries]);

  useEffect(() => {
    setCommentDraft('');
  }, [selectedDate]);

  const { generateForCycle } = useAutoDiaryScheduler({
    onStatus: (msg) => {
      setStatusMsg(msg);
      if (msg.includes('正在撰写') || msg.includes('正在生成')) {
        setGenerating(true);
      } else {
        setGenerating(false);
      }
    },
    onDiaryGenerated: ({
      targetDateKey,
      entries: nextEntries,
      summaries: nextSummaries,
    }) => {
      setEntries(nextEntries);
      setSummaries(nextSummaries);
      if (targetDateKey) {
        setSelectedDate(targetDateKey);
      }
      setGenerating(false);
    },
  });

  const handleGenerateDiary = useCallback(async () => {
    setGenerating(true);
    await generateForCycle({ isAuto: false });
    setGenerating(false);
  }, [generateForCycle]);

  const activeEntry =
    entries.find((item) => item.date === selectedDate) || entries[0] || null;

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

  async function handleDeleteEntry(dateToDelete) {
    const nextEntries = entries.filter((item) => item.date !== dateToDelete);
    const completedBatchCount = Math.floor(nextEntries.length / DIARY_BATCH_SIZE);
    const nextSummaries = summaries
      .filter(
        (s) =>
          typeof s.batchIndex === 'number' &&
          s.batchIndex <= completedBatchCount
      )
      .sort((a, b) => a.batchIndex - b.batchIndex);

    setEntries(nextEntries);
    setSummaries(nextSummaries);
    writeStorageJSON(DIARY_STORAGE_KEY, nextEntries);
    writeStorageJSON(DIARY_SUMMARIES_KEY, nextSummaries);

    if (selectedDate === dateToDelete) {
      setSelectedDate(
        nextEntries[0]?.date || getPreviousCycleWindow().targetDateKey
      );
    }
    setStatusMsg('已删除该篇日记');

    if (completedBatchCount > 0 && nextSummaries.length < completedBatchCount) {
      const rebuilt = await syncDiaryBatchSummaries(
        nextEntries,
        nextSummaries,
        undefined,
        setStatusMsg
      );
      setSummaries(rebuilt);
    }
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
        每满 {DIARY_BATCH_SIZE} 篇生成 1 篇摘要（当前 {entries.length} 篇日记 /{' '}
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
              {DIARY_BATCH_SIZE} 篇会自动生成 1 篇摘要。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
