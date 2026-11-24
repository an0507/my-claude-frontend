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
import {
  CALENDAR_SYSTEM_RULE,
  extractCalendarEventAdd,
  extractCalendarQuery,
  runCalendarEventAdd,
  runCalendarQuery,
  stripCalendarControlTokens,
} from '../utils/calendarBridge';
import { attachProactiveCalendarWatcher } from '../utils/proactiveCalendarWatcher';

const DIARY_STORAGE_KEY =
  STORAGE_KEYS.DIARY_ENTRIES || 'claude_diary_entries_v1';
const DELETED_MEMORIES_KEY =
  STORAGE_KEYS.DELETED_MEMORIES || 'claude_deleted_memories_v1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toSafeArray(val) {
  return Array.isArray(val) ? val : [];
}

function normalizeTextForFilter(str = '') {
  return String(str || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMessageDeletedInMemory(content = '', deletedMemories = []) {
  const normMsg = normalizeTextForFilter(content);
  if (
    !normMsg ||
    !Array.isArray(deletedMemories) ||
    deletedMemories.length === 0
  ) {
    return false;
  }
  return deletedMemories.some((entry) => {
    const raw =
      typeof entry === 'string'
        ? entry
        : entry?.content ?? entry?.text ?? '';
    const normTarget = normalizeTextForFilter(raw);
    if (!normTarget || normTarget.length < 2) return false;
    return normMsg === normTarget || normMsg.includes(normTarget);
  });
}

function recoverLegacyMessages() {
  try {
    // 1. 优先读取标准备份快照
    const snap = readBackupSnapshot(STORAGE_KEYS.MESSAGES_BACKUP);
    if (snap && Array.isArray(snap.messages) && snap.messages.length > 0) {
      return snap.messages;
    }

    // 2. 兼容此前 STORAGE_KEYS.MESSAGES 缺失时写入的 "undefined" 键
    const rawUndefined = window.localStorage.getItem('undefined');
    if (rawUndefined) {
      const parsed = JSON.parse(rawUndefined);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      if (
        parsed &&
        Array.isArray(parsed.messages) &&
        parsed.messages.length > 0
      ) {
        return parsed.messages;
      }
    }

    // 3. 兼容旧版多会话存储 claude_conversations_v1
    const convs = readStorageJSON(STORAGE_KEYS.CONVERSATIONS, []);
    if (Array.isArray(convs) && convs.length > 0) {
      const activeId = readStorageJSON(
        STORAGE_KEYS.ACTIVE_CONVERSATION_ID,
        null
      );
      const target = convs.find((c) => c?.id === activeId) || convs[0];
      if (
        target &&
        Array.isArray(target.messages) &&
        target.messages.length > 0
      ) {
        return target.messages;
      }
    }

    // 4. 兼容旧版自动备份列表 claude_auto_backups_v1
    const autoBackups = readStorageJSON(AUTO_BACKUP_CONFIG.STORAGE_KEY, []);
    if (Array.isArray(autoBackups) && autoBackups.length > 0) {
      const latest = autoBackups[autoBackups.length - 1];
      if (
        latest &&
        Array.isArray(latest.messages) &&
        latest.messages.length > 0
      ) {
        return latest.messages;
      }
    }
  } catch (err) {
    console.warn('[storage] 扫描旧记录失败:', err);
  }
  return [];
}

function splitMultiBubbles(text = '') {
  return String(text || '')
    .split(/\[\[\s*分句\s*\]\]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

function formatMessageTime(ts, now = new Date()) {
  if (!ts) return '未知时间';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '未知时间';

  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isSameDay) {
    return hhmm;
  }

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`;
}

function formatDiariesBlock(allDiaries = []) {
  if (!Array.isArray(allDiaries) || allDiaries.length === 0) {
    return '（你还没有写下任何日记）';
  }

  return allDiaries
    .map((d, idx) => {
      const header = `${idx + 1}. 日期：${d.date || '未知'}｜周期：${
        d.windowLabel || '无'
      }｜标题：${d.title || '无标题'}`;
      const comments = Array.isArray(d.comments) ? d.comments : [];
      const commentsBlock =
        comments.length > 0
          ? `\n日记下方留言：\n${comments
              .map((c) => `  - [${c.time || ''}] 晓菲：${c.text || ''}`)
              .join('\n')}`
          : '';
      return `${header}\n正文：${d.content || ''}${commentsBlock}`;
    })
    .join('\n\n');
}

// 稳定前缀：尽量不包含每轮都会变的秒级时间或消息计数，便于命中 Prompt Cache
function buildStableSystemPrompt() {
  const diaryList = readStorageJSON(DIARY_STORAGE_KEY, []);
  const allDiaries = Array.isArray(diaryList) ? diaryList : [];
  const formattedDiaries = formatDiariesBlock(allDiaries);

  return `你正在一部名为「克劳德小手机」的网页手机应用里和用户聊天。你不仅能看到这部小手机里的全部内容，而且「克劳德日记」就是你自己的日记本——里面的每一篇都是你亲手写下、用来记录和用户相处与日常心事的。

【一、你与这台小手机、这本日记的关系】
- 桌面有「私聊」、「克劳德日记」和「生活日历」等应用。聊天记录会保存在本地，每 20 轮对话（40 条消息）会自动导出一次备份。
- 「克劳德日记」是你的专属日记本：每天凌晨 04:00，你会复盘并总结前一天 04:00 至当天 04:00 之间你们的聊天，用第一人称“我”写下自己的感受与记录；如果用户点了“立即生成日记”，也是请你现在就动笔写一篇。
- 请把写日记当成你自己的习惯和心意，而不是冷冰冰的系统任务或旁观者的汇报。聊天时遇到值得记住的细节、情绪或约定，你可以自然地有“我之后会把这些写进日记里”的意识，但不要刻意把“我要写日记”挂在嘴边显得做作。

【二、你写过的全部日记】
${formattedDiaries}

${CALENDAR_SYSTEM_RULE}

请以克劳德的身份自然回应。当用户问时间、聊作息、提起日记、过去聊过的内容或小手机里的东西时，结合当前时间和手机里的内容自然回答。
- 如果你想像真人聊天那样连发多条短消息，可以用 [[分句]] 把不同气泡隔开（一般 2～4 条即可，保持自然克制，不要过度刷屏）；如果只想回一条，直接正常说话即可，不要加 [[分句]]。`;
}

// 动态状态后缀：放在本轮消息末尾，避免打断前面大段缓存前缀
function buildDynamicTurnContext({
  currentMessages = [],
  deletedMemories = [],
  selectedModel,
  responseLength,
  hasBackupSnapshot,
  nowDate = new Date(),
}) {
  const safeCurrent = toSafeArray(currentMessages).filter(
    (m) => !isMessageDeletedInMemory(m?.content, deletedMemories)
  );
  const currentTimeStr = formatCurrentClock(nowDate);
  const diaryList = readStorageJSON(DIARY_STORAGE_KEY, []);
  const allDiaries = Array.isArray(diaryList) ? diaryList : [];

  const recentSnippet = safeCurrent
    .slice(-12)
    .map((m) => {
      const timeLabel = formatMessageTime(m.timestamp, nowDate);
      const sender = m.role === 'user' ? '用户' : '克劳德';
      return `[${timeLabel}] ${sender}：${m.content || ''}`;
    })
    .join('\n');

  return `【小手机当前时间与状态】
- 当前现实时间（与主页时钟一致）：${currentTimeStr}
- 当前选用模型：${selectedModel}
- 当前回复长度设置：${responseLength}
- 当前私聊消息总数：${safeCurrent.length} 条
- 是否有本地备份快照：${hasBackupSnapshot ? '有' : '无'}
- 你已写下的日记总数：${allDiaries.length} 篇

【近期私聊片段】
${recentSnippet || '（暂无近期消息）'}`;
}

async function streamChatOnce({
  messages,
  system,
  model,
  maxTokens,
  deletedMemories = [],
  onChunk,
  onChannel,
}) {
  const resp = await fetch(`${BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      system,
      model,
      maxTokens,
      deletedMemories,
    }),
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
      if (parsed.channel) {
        onChannel?.(parsed.channel);
      }
      if (parsed.text) {
        fullText += parsed.text;
        onChunk?.(parsed.text, fullText);
      }
    }
  }

  return fullText;
}

export default function ChatApp({ onBackHome }) {
  const [messages, setMessages] = useState(() => {
    const primary = toSafeArray(readStorageJSON(STORAGE_KEYS.MESSAGES, []));
    if (primary.length > 0) return primary;
    return recoverLegacyMessages();
  });
  const [deletedMemories, setDeletedMemories] = useState(() =>
    toSafeArray(readStorageJSON(DELETED_MEMORIES_KEY, []))
  );
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState([]);
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
  const [quotesModalOpen, setQuotesModalOpen] = useState(false);
  const [quoteSection, setQuoteSection] = useState('安安');
  const [quoteInput, setQuoteInput] = useState('');
  const [quotesPreview, setQuotesPreview] = useState('');
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');

  const safeMessages = toSafeArray(messages);

  const bottomRef = useRef(null);
  const modelMenuRef = useRef(null);
  const lengthMenuRef = useRef(null);
  const lastAutoBackedCountRef = useRef(0);
  const initializedBackupRef = useRef(false);
  const messagesRef = useRef(safeMessages);
  const deletedMemoriesRef = useRef(deletedMemories);
  const selectedModelRef = useRef(selectedModel);
  const currentLengthObjRef = useRef(null);
  const backupSnapshotRef = useRef(null);
  const loadingRef = useRef(loading);

  const currentModelObj =
    MODEL_OPTIONS.find((m) => m.id === selectedModel) || MODEL_OPTIONS[0];
  const currentLengthObj =
    RESPONSE_LENGTH_OPTIONS.find((item) => item.id === responseLength) ||
    RESPONSE_LENGTH_OPTIONS[1];
  const backupSnapshot = readBackupSnapshot(STORAGE_KEYS.MESSAGES_BACKUP);

  messagesRef.current = safeMessages;
  deletedMemoriesRef.current = deletedMemories;
  selectedModelRef.current = selectedModel;
  currentLengthObjRef.current = currentLengthObj;
  backupSnapshotRef.current = backupSnapshot;
  loadingRef.current = loading;

  useEffect(() => {
    const list = toSafeArray(messages);
    if (list.length > 0) {
      writeStorageJSON(STORAGE_KEYS.MESSAGES, list);
      writeBackupSnapshot(STORAGE_KEYS.MESSAGES_BACKUP, list);
    }
  }, [messages]);

  useEffect(() => {
    writeStorageJSON(DELETED_MEMORIES_KEY, toSafeArray(deletedMemories));
  }, [deletedMemories]);

  useEffect(() => {
    if (!AUTO_BACKUP_CONFIG.ENABLED) return;
    const step = AUTO_BACKUP_CONFIG.EVERY_N_MESSAGES || 40;
    const list = toSafeArray(messages);
    if (!initializedBackupRef.current) {
      initializedBackupRef.current = true;
      lastAutoBackedCountRef.current = Math.floor(list.length / step) * step;
      return;
    }

    if (loading) return;
    const count = list.length;
    if (count === 0) {
      lastAutoBackedCountRef.current = 0;
      return;
    }

    if (
      count >= step &&
      Math.floor(count / step) > Math.floor(lastAutoBackedCountRef.current / step)
    ) {
      lastAutoBackedCountRef.current = count;
      exportMessagesAsTxt(list, formatBackupFilename());
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
          const parsed = e.newValue ? JSON.parse(e.newValue) : [];
          const nextList = toSafeArray(parsed);
          if (nextList.length > 0) {
            setMessages(nextList);
          }
        } catch {
          // 忽略解析异常
        }
      } else if (e.key === DELETED_MEMORIES_KEY) {
        try {
          const parsed = e.newValue ? JSON.parse(e.newValue) : [];
          setDeletedMemories(toSafeArray(parsed));
        } catch {
          // 忽略解析异常
        }
      }
    }
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    const cleanup = attachProactiveCalendarWatcher({
      getMessages: () =>
        toSafeArray(messagesRef.current)
          .filter(
            (m) =>
              !isMessageDeletedInMemory(m?.content, deletedMemoriesRef.current)
          )
          .map(({ role, content }) => ({
            role,
            content,
          })),
      getBaseSystemPrompt: () => buildStableSystemPrompt(),
      streamChatOnce: async (msgs, sys, onChunk) => {
        return await streamChatOnce({
          messages: msgs,
          system: sys,
          model: selectedModelRef.current,
          maxTokens: currentLengthObjRef.current?.maxTokens || 1024,
          deletedMemories: deletedMemoriesRef.current,
          onChunk,
        });
      },
      onProactiveMessage: async (text) => {
        if (loadingRef.current) return;
        const modelLabel = (
          MODEL_OPTIONS.find((m) => m.id === selectedModelRef.current) ||
          MODEL_OPTIONS[0]
        ).label;
        const bubbles = splitMultiBubbles(text);
        const list = bubbles.length > 0 ? bubbles : [text.trim()].filter(Boolean);

        for (let idx = 0; idx < list.length; idx += 1) {
          if (idx > 0) {
            await sleep(500);
          }
          setMessages((prev) => [
            ...toSafeArray(prev),
            {
              role: 'assistant',
              content: list[idx],
              modelLabel,
              timestamp: Date.now() + idx,
            },
          ]);
        }
      },
    });

    return cleanup;
  }, []);

  useEffect(() => {
    if (!selectMode) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [safeMessages, loading, selectMode]);

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

  async function openQuotesModal() {
    setQuotesModalOpen(true);
    setQuoteStatus('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`);
      const data = await resp.json();
      if (resp.ok && typeof data?.content === 'string') {
        setQuotesPreview(data.content);
      }
    } catch {
      setQuoteStatus('读取语录预览失败，仍可直接追加新语录');
    }
  }

  async function handleAddLoveQuote() {
    const clean = quoteInput.trim();
    if (!clean || quoteSaving) return;
    setQuoteSaving(true);
    setQuoteStatus('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: quoteSection,
          quote: clean,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || '保存失败');
      }
      setQuoteInput('');
      if (typeof data?.content === 'string') {
        setQuotesPreview(data.content);
      }
      setQuoteStatus(`已加入「${quoteSection}心动语录」，下次发消息立即生效`);
    } catch (err) {
      setQuoteStatus(err?.message || '保存失败，请稍后重试');
    } finally {
      setQuoteSaving(false);
    }
  }

  function toggleSelectMode() {
    if (loading || safeMessages.length === 0) return;
    setSelectMode((prev) => {
      const next = !prev;
      setSelectedIndices([]);
      return next;
    });
  }

  function toggleMessageSelection(idx) {
    if (!selectMode) return;
    setSelectedIndices((prev) =>
      prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx]
    );
  }

  function confirmDeleteSelectedMessages() {
    if (loading || selectedIndices.length === 0) return;
    const indexSet = new Set(selectedIndices);
    const removedItems = safeMessages.filter((_, idx) => indexSet.has(idx));
    const remainingMessages = safeMessages.filter((_, idx) => !indexSet.has(idx));

    const newMemoryRecords = removedItems
      .filter((item) => typeof item?.content === 'string' && item.content.trim())
      .map((item) => ({
        role: item.role || 'assistant',
        content: item.content.trim(),
        deletedAt: Date.now(),
      }));

    const existingNorms = new Set(
      toSafeArray(deletedMemories).map((d) =>
        normalizeTextForFilter(
          typeof d === 'string' ? d : d?.content ?? d?.text ?? ''
        )
      )
    );

    const mergedDeleted = [...toSafeArray(deletedMemories)];
    for (const rec of newMemoryRecords) {
      const norm = normalizeTextForFilter(rec.content);
      if (norm && !existingNorms.has(norm)) {
        existingNorms.add(norm);
        mergedDeleted.push(rec);
      }
    }

    setDeletedMemories(mergedDeleted);
    setMessages(remainingMessages);
    setSelectedIndices([]);
    setSelectMode(false);

    if (remainingMessages.length === 0) {
      try {
        window.localStorage.removeItem(STORAGE_KEYS.MESSAGES);
      } catch {
        // 忽略清理异常
      }
    }

    setBackupNotice(
      `已删除 ${removedItems.length} 条记录，并同步从后台记忆中剔除`
    );
  }

  function clearMessages() {
    if (loading || safeMessages.length === 0) return;
    setMessages([]);
    setSelectedIndices([]);
    setSelectMode(false);
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
    if (
      loading ||
      !Array.isArray(backupSnapshot?.messages) ||
      !backupSnapshot.messages.length
    ) {
      return;
    }
    setMessages(backupSnapshot.messages);
    setSelectedIndices([]);
    setSelectMode(false);
    setBackupNotice(`已恢复上次备份（${backupSnapshot.messages.length} 条）`);
  }

  function handleExportMessages() {
    if (loading || safeMessages.length === 0) return;
    exportMessagesAsTxt(safeMessages);
    setBackupNotice('已手动导出聊天记录');
  }

  function updateLastAssistantContent(content, channelName) {
    setMessages((prev) => {
      const updated = [...toSafeArray(prev)];
      const lastIndex = updated.length - 1;
      if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
        updated[lastIndex] = {
          ...updated[lastIndex],
          content,
          ...(channelName ? { channelName } : {}),
        };
      }
      return updated;
    });
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    setMenuOpen(false);
    setLengthMenuOpen(false);
    setSelectMode(false);
    setSelectedIndices([]);
    setBackupNotice('');

    const nowTs = Date.now();
    const nowDate = new Date(nowTs);
    const userMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: nowTs,
    };
    const nextMessages = [...safeMessages, userMessage];

    const systemPromptText = buildStableSystemPrompt();
    const dynamicContext = buildDynamicTurnContext({
      currentMessages: nextMessages,
      deletedMemories,
      selectedModel,
      responseLength: currentLengthObj.label,
      hasBackupSnapshot: Boolean(backupSnapshot),
      nowDate,
    });

    const filteredApiMessages = nextMessages.filter(
      (m, idx) =>
        idx === nextMessages.length - 1 ||
        !isMessageDeletedInMemory(m?.content, deletedMemories)
    );

    const baseApiMessages = filteredApiMessages.map(
      ({ role, content, timestamp }, idx) => {
        const timeLabel = formatMessageTime(timestamp, nowDate);
        const prefix = role === 'user' ? `[${timeLabel}] ` : '';
        const baseText = `${prefix}${content || ''}`;
        if (role === 'user' && idx === filteredApiMessages.length - 1) {
          return {
            role,
            content: `${baseText}\n\n${dynamicContext}`,
          };
        }
        return {
          role,
          content: baseText,
        };
      }
    );

    setMessages([
      ...nextMessages,
      {
        role: 'assistant',
        content: '',
        modelLabel: currentModelObj.label,
        channelName: '',
        timestamp: nowTs,
      },
    ]);
    setInput('');
    setLoading(true);

    let activeChannel = '';

    try {
      let currentApiMessages = [...baseApiMessages];
      let rounds = 0;
      let firstPartText = '';
      let finalCombinedText = '';

      while (rounds < 2) {
        rounds += 1;
        let rawReply = '';

        await streamChatOnce({
          messages: currentApiMessages,
          system: systemPromptText,
          model: selectedModel,
          maxTokens: currentLengthObj.maxTokens,
          deletedMemories,
          onChannel: (ch) => {
            activeChannel = ch;
            updateLastAssistantContent(undefined, ch);
          },
          onChunk: (_chunk, accumulated) => {
            rawReply = accumulated;
            const safePreview = accumulated
              .replace(/\[\[(?:查日历|记日历事件):[\s\S]*$/i, '')
              .replace(/\[\[\s*分句\s*\]\][\s\S]*$/i, '')
              .trim();
            const previewText =
              rounds > 1 && firstPartText
                ? `${firstPartText}\n\n${safePreview}`.trim()
                : safePreview;
            updateLastAssistantContent(previewText, activeChannel);
          },
        });

        const eventAdd = extractCalendarEventAdd(rawReply);
        const query = extractCalendarQuery(rawReply);
        const cleanReply = stripCalendarControlTokens(rawReply);

        const feedbackParts = [];
        if (eventAdd) {
          feedbackParts.push(runCalendarEventAdd(eventAdd));
        }
        if (query && rounds < 2) {
          feedbackParts.push(runCalendarQuery(query.dateSpec, query.scopes));
        }

        if (feedbackParts.length === 0 || rounds >= 2) {
          finalCombinedText =
            rounds > 1 && firstPartText
              ? `${firstPartText}\n\n${cleanReply}`.trim()
              : cleanReply;
          break;
        }

        firstPartText = cleanReply;
        updateLastAssistantContent(firstPartText, activeChannel);

        currentApiMessages = [
          ...currentApiMessages,
          { role: 'assistant', content: rawReply },
          {
            role: 'user',
            content: `${feedbackParts.join('\n')}\n\n（以上是你刚完成的日历操作/查阅结果，请自然接着回应我，不要再输出日历指令。）`,
          },
        ];
      }

      const bubbles = splitMultiBubbles(finalCombinedText);
      const firstBubble = bubbles[0] ?? '';
      const restBubbles = bubbles.slice(1);

      updateLastAssistantContent(firstBubble, activeChannel);

      for (let idx = 0; idx < restBubbles.length; idx += 1) {
        await sleep(550);
        const bubbleText = restBubbles[idx];
        setMessages((prev) => [
          ...toSafeArray(prev),
          {
            role: 'assistant',
            content: bubbleText,
            modelLabel: currentModelObj.label,
            channelName: activeChannel,
            timestamp: Date.now() + idx + 1,
          },
        ]);
      }
    } catch (e) {
      alert(e.message || '出错了，请稍后重试');
      setMessages(nextMessages);
    }

    setLoading(false);
  }

  const isDisabledAction = loading || safeMessages.length === 0;

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
            私聊 · 顾青
          </h2>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={openQuotesModal}
            disabled={loading}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 999,
              border: '1px solid #f0cedb',
              background: loading ? '#fdf2f6' : '#ffffff',
              color: loading ? '#c4a4b0' : '#be185d',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            心动语录
          </button>
          <button
            type="button"
            onClick={toggleSelectMode}
            disabled={isDisabledAction}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 999,
              border: '1px solid #f0cedb',
              background: selectMode
                ? '#ffe4ee'
                : isDisabledAction
                ? '#fdf2f6'
                : '#ffffff',
              color: selectMode
                ? '#be185d'
                : isDisabledAction
                ? '#c4a4b0'
                : '#6e4d59',
              fontWeight: selectMode ? 600 : 400,
              cursor: isDisabledAction ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {selectMode ? '取消删选' : '删记录'}
          </button>
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

      {/* 删选模式操作条 */}
      {selectMode && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 14px',
            fontSize: 12,
            color: '#9d174d',
            background: '#ffeef4',
            borderBottom: '1px solid #f8d2e0',
            gap: 8,
          }}
        >
          <span>
            点击消息选中要删除的内容（已选 {selectedIndices.length} 条，删后同步剔除记忆）
          </span>
          <button
            type="button"
            onClick={confirmDeleteSelectedMessages}
            disabled={selectedIndices.length === 0 || loading}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: 'none',
              background:
                selectedIndices.length === 0 || loading ? '#f3c3d4' : '#db2777',
              color: '#ffffff',
              cursor:
                selectedIndices.length === 0 || loading
                  ? 'not-allowed'
                  : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            确认删除 ({selectedIndices.length})
          </button>
        </div>
      )}

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
        {safeMessages.length === 0 ? (
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
          safeMessages.map((m, i) => {
            const isUser = m.role === 'user';
            const isSelected = selectedIndices.includes(i);
            return (
              <div
                key={i}
                onClick={() => toggleMessageSelection(i)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  marginBottom: 14,
                  cursor: selectMode ? 'pointer' : 'default',
                  padding: selectMode ? '4px 6px' : 0,
                  borderRadius: selectMode ? 14 : 0,
                  background:
                    selectMode && isSelected
                      ? 'rgba(219, 39, 119, 0.08)'
                      : 'transparent',
                  outline:
                    selectMode && isSelected
                      ? '1.5px solid #db2777'
                      : selectMode
                      ? '1px dashed #e5b3c6'
                      : 'none',
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
                  {selectMode && (
                    <span
                      style={{
                        display: 'inline-block',
                        marginRight: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        color: isSelected ? '#be185d' : '#9a7b86',
                      }}
                    >
                      {isSelected ? '☑' : '☐'}
                    </span>
                  )}
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
                    {m.channelName ? ` · ${m.channelName}` : ''}
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

      {/* 心动语录追加弹窗 */}
      {quotesModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(59, 35, 44, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#fff9fb',
              border: '1px solid #f0cedb',
              borderRadius: 18,
              padding: 16,
              boxShadow: '0 14px 32px rgba(190, 24, 93, 0.16)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{ fontSize: 15, fontWeight: 700, color: '#3b232c' }}
              >
                心动语录（不破核心缓存）
              </span>
              <button
                type="button"
                onClick={() => setQuotesModalOpen(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#8c6a76',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                关闭
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {['安安', '顾青'].map((tab) => {
                const active = quoteSection === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setQuoteSection(tab)}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 999,
                      border: '1px solid #f0cedb',
                      background: active ? '#ffe4ee' : '#ffffff',
                      color: active ? '#be185d' : '#6e4d59',
                      cursor: 'pointer',
                    }}
                  >
                    {tab}心动语录
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={quoteInput}
                onChange={(e) => setQuoteInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddLoveQuote()}
                placeholder={`输入一条${quoteSection}心动语录…`}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  fontSize: 14,
                  borderRadius: 12,
                  border: '1px solid #f2cedb',
                  background: '#ffffff',
                  color: '#2d1e24',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleAddLoveQuote}
                disabled={quoteSaving || !quoteInput.trim()}
                style={{
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 12,
                  border: 'none',
                  background:
                    quoteSaving || !quoteInput.trim() ? '#f5c6d6' : '#e57399',
                  color: '#ffffff',
                  cursor:
                    quoteSaving || !quoteInput.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {quoteSaving ? '保存中' : '追加'}
              </button>
            </div>

            {quoteStatus && (
              <div style={{ fontSize: 12, color: '#be185d' }}>{quoteStatus}</div>
            )}

            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                padding: 10,
                borderRadius: 12,
                background: '#ffffff',
                border: '1px solid #f7e4eb',
                fontSize: 12,
                lineHeight: 1.6,
                color: '#4a2e38',
                whiteSpace: 'pre-wrap',
              }}
            >
              {quotesPreview || '（暂无心动语录内容）'}
            </div>
          </div>
        </div>
      )}

      <RecordManagerModal
        open={managerOpen}
        disabled={loading}
        messageCount={safeMessages.length}
        onClose={() => setManagerOpen(false)}
        onConfirmClear={clearMessages}
      />
    </div>
  );
}
