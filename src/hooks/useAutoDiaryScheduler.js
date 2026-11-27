import { useCallback, useEffect, useRef } from 'react';
import {
  BACKEND_URL,
  DEFAULT_MODEL,
  STORAGE_KEYS,
} from '../constants/chatConfig';
import { readStorageJSON, writeStorageJSON } from '../utils/storage';

export const DIARY_STORAGE_KEY =
  STORAGE_KEYS.DIARY_ENTRIES || 'claude_diary_entries_v1';
export const DIARY_SUMMARIES_KEY = 'claude_diary_memory_summaries_v1';
export const DIARY_UPDATED_EVENT = 'claude-diary-updated';
const AUTO_RUN_ATTEMPT_KEY = 'claude_diary_auto_attempt_v1';

export const DIARY_BATCH_SIZE = 5;
export const MAX_DIARY_MESSAGES = 150;
export const MAX_DIARY_TRANSCRIPT_CHARS = 20000;
export const DIARY_MAX_TOKENS = 2000;
export const SUMMARY_MAX_TOKENS = 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatDiaryDateKey(dateObj) {
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(
    dateObj.getDate()
  )}`;
}

export function getPreviousCycleWindow(now = new Date()) {
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
  const targetDateKey = formatDiaryDateKey(startAt);

  return {
    targetDateKey,
    startAt,
    endAt,
    isAfterTodayFourAM: now >= todayFourAM,
    windowLabel: `${formatDiaryDateKey(startAt)} 04:00 ～ ${formatDiaryDateKey(
      endAt
    )} 04:00`,
  };
}

function formatReadableDate(dateKey) {
  const parts = String(dateKey || '').split('-');
  if (parts.length !== 3) return dateKey;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
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

export function notifyDiaryUpdated(detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DIARY_UPDATED_EVENT, { detail }));
  }
}

export function buildBoundedTranscript(
  messages,
  maxChars = MAX_DIARY_TRANSCRIPT_CHARS
) {
  const picked = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const speaker = m.role === 'user' ? '我' : '克劳德';
    const rawContent = String(m.content || '').trim();
    if (!rawContent) continue;

    const line = `${speaker}：${rawContent}`;
    const cost = line.length + (picked.length > 0 ? 1 : 0);

    if (totalChars + cost > maxChars) {
      if (picked.length === 0) {
        picked.push(
          `${speaker}：${rawContent.slice(-Math.max(100, maxChars - 10))}`
        );
      }
      break;
    }

    picked.push(line);
    totalChars += cost;
  }

  return picked.reverse().join('\n');
}

export async function fetchDiaryStreamText(payload) {
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

  const consumeChunk = (rawChunk) => {
    const lines = rawChunk.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;
      if (dataStr === '[DONE]') return true;

      let parsed = null;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (parsed?.error) {
        throw new Error(parsed.error);
      }
      if (typeof parsed?.text === 'string') {
        fullText += parsed.text;
      }
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const shouldStop = consumeChunk(part);
      if (shouldStop) {
        return fullText.trim();
      }
    }
  }

  if (buffer.trim()) {
    consumeChunk(buffer);
  }

  return fullText.trim();
}

export async function syncDiaryBatchSummaries(
  allEntries,
  currentSummaries,
  modelToUse,
  onStatus
) {
  const chrono = sortChronological(allEntries);
  const completedBatchCount = Math.floor(chrono.length / DIARY_BATCH_SIZE);

  const validSummaries = (
    Array.isArray(currentSummaries) ? currentSummaries : []
  )
    .filter(
      (s) =>
        typeof s.batchIndex === 'number' && s.batchIndex <= completedBatchCount
    )
    .sort((a, b) => a.batchIndex - b.batchIndex);

  if (completedBatchCount === 0) {
    return [];
  }

  let updatedSummaries = [...validSummaries];

  for (let batchIdx = 1; batchIdx <= completedBatchCount; batchIdx += 1) {
    const start = (batchIdx - 1) * DIARY_BATCH_SIZE;
    const batchSlice = chrono.slice(start, start + DIARY_BATCH_SIZE);
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

    if (typeof onStatus === 'function') {
      onStatus(
        `日记已满 ${batchIdx * DIARY_BATCH_SIZE} 篇，正在生成${rangeLabel}摘要…`
      );
    }

    const batchText = batchSlice
      .map(
        (d, idx) =>
          `第${start + idx + 1}篇（${d.date}｜${d.title || '无标题'}）：\n${
            d.content || ''
          }${formatCommentsForPrompt(d.comments)}`
      )
      .join('\n\n');

    const summaryText = await fetchDiaryStreamText({
      messages: [
        {
          role: 'user',
          content: `请将下面这 ${DIARY_BATCH_SIZE} 篇日记合并概括成 1 篇精简摘要（控制在 150~250 字左右）。
要求：保留核心事件、情绪变化、重要约定和人物/日常细节，用客观简洁的中文连贯写出，不要分点编号，也不要加“摘要：”前缀。

${batchText}`,
        },
      ],
      model: modelToUse,
      maxTokens: SUMMARY_MAX_TOKENS,
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
}

export function useAutoDiaryScheduler({ onDiaryGenerated, onStatus } = {}) {
  const runningRef = useRef(false);
  const onGeneratedRef = useRef(onDiaryGenerated);
  const onStatusRef = useRef(onStatus);
  onGeneratedRef.current = onDiaryGenerated;
  onStatusRef.current = onStatus;

  const generateForCycle = useCallback(async ({ isAuto = true } = {}) => {
    if (runningRef.current) return { ok: false, reason: 'busy' };

    const now = new Date();
    const cycle = getPreviousCycleWindow(now);
    const allMessages = readStorageJSON(STORAGE_KEYS.MESSAGES, []);

    if (!Array.isArray(allMessages) || allMessages.length === 0) {
      if (!isAuto && typeof onStatusRef.current === 'function') {
        onStatusRef.current('还没有聊天记录，先去「私聊」里聊几句吧。');
      }
      return { ok: false, reason: 'no_messages' };
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

    if (isAuto && scopedMessages.length === 0) {
      return { ok: false, reason: 'empty_cycle' };
    }

    scopedMessages = scopedMessages.slice(-MAX_DIARY_MESSAGES);
    const transcript = buildBoundedTranscript(
      scopedMessages,
      MAX_DIARY_TRANSCRIPT_CHARS
    );
    if (!transcript) {
      return { ok: false, reason: 'empty_transcript' };
    }

    const savedModel = readStorageJSON(STORAGE_KEYS.SELECTED_MODEL, null);
    const modelToUse =
      typeof savedModel === 'string' && savedModel ? savedModel : DEFAULT_MODEL;

    if (isAuto) {
      writeStorageJSON(AUTO_RUN_ATTEMPT_KEY, {
        targetDateKey: cycle.targetDateKey,
        attemptedAt: Date.now(),
      });
    }

    runningRef.current = true;
    if (!isAuto && typeof onStatusRef.current === 'function') {
      onStatusRef.current(
        `正在撰写 ${formatReadableDate(cycle.targetDateKey)}（${
          cycle.windowLabel
        }）的日记…`
      );
    }

    try {
      const trimmed = await fetchDiaryStreamText({
        messages: [
          {
            role: 'user',
            content: `日记归属日期是 ${cycle.targetDateKey}，总结的时间段是 ${cycle.windowLabel}。请你以“克劳德”的身份，根据下面我和你的聊天记录，写一篇温柔、自然、有生活感的日记。
要求：
1. 第一行写一个简短的日记标题（不要加“标题：”前缀）。
2. 空一行后写日记正文，用第一人称“我”指代克劳德，用“你”指代聊天对象，总结这段时间聊到的内容、情绪和印象深刻的小细节。
3. 正文字数控制在 300~800 字左右，层次自然、细节饱满，不要列冰冷的要点清单。

聊天记录：
${transcript}`,
          },
        ],
        model: modelToUse,
        maxTokens: DIARY_MAX_TOKENS,
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

      const currentEntries = readStorageJSON(DIARY_STORAGE_KEY, []);
      const currentSummaries = readStorageJSON(DIARY_SUMMARIES_KEY, []);
      const existingSameDay = currentEntries.find(
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
        ...currentEntries.filter((item) => item.date !== cycle.targetDateKey),
      ].sort((a, b) => b.date.localeCompare(a.date));

      writeStorageJSON(DIARY_STORAGE_KEY, mergedEntries);

      const syncedSummaries = await syncDiaryBatchSummaries(
        mergedEntries,
        currentSummaries,
        modelToUse,
        isAuto ? null : onStatusRef.current
      );
      writeStorageJSON(DIARY_SUMMARIES_KEY, syncedSummaries);
      notifyDiaryUpdated({
        targetDateKey: cycle.targetDateKey,
        entries: mergedEntries,
        summaries: syncedSummaries,
      });

      const doneMsg = `已存入 ${formatReadableDate(
        cycle.targetDateKey
      )} 的日记（当前共 ${mergedEntries.length} 篇，已生成 ${
        syncedSummaries.length
      } 篇摘要）`;

      if (!isAuto && typeof onStatusRef.current === 'function') {
        onStatusRef.current(doneMsg);
      }
      if (typeof onGeneratedRef.current === 'function') {
        onGeneratedRef.current({
          targetDateKey: cycle.targetDateKey,
          entries: mergedEntries,
          summaries: syncedSummaries,
          message: doneMsg,
          isAuto,
        });
      }

      return {
        ok: true,
        targetDateKey: cycle.targetDateKey,
        entries: mergedEntries,
        summaries: syncedSummaries,
      };
    } catch (err) {
      const errMsg = err?.message || '生成失败，请稍后再试';
      if (!isAuto && typeof onStatusRef.current === 'function') {
        onStatusRef.current(errMsg);
      }
      return { ok: false, error: errMsg };
    } finally {
      runningRef.current = false;
    }
  }, []);

  const checkAutoGenerate = useCallback(() => {
    if (runningRef.current) return;
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return;
    }

    const now = new Date();
    const cycle = getPreviousCycleWindow(now);
    if (!cycle.isAfterTodayFourAM) return;

    const currentEntries = readStorageJSON(DIARY_STORAGE_KEY, []);
    const alreadyExists = currentEntries.some(
      (item) => item.date === cycle.targetDateKey
    );
    if (alreadyExists) return;

    const lastAttempt = readStorageJSON(AUTO_RUN_ATTEMPT_KEY, null);
    if (
      lastAttempt &&
      lastAttempt.targetDateKey === cycle.targetDateKey &&
      typeof lastAttempt.attemptedAt === 'number' &&
      now.getTime() - lastAttempt.attemptedAt < 10 * 60 * 1000
    ) {
      return;
    }

    generateForCycle({ isAuto: true });
  }, [generateForCycle]);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      checkAutoGenerate();
    }, 800);

    const intervalId = setInterval(() => {
      checkAutoGenerate();
    }, 60 * 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAutoGenerate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkAutoGenerate]);

  return {
    generateForCycle,
    checkAutoGenerate,
    isRunning: runningRef.current,
  };
}
