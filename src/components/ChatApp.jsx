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

const MAX_WINDOW_HISTORY_MESSAGES = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toSafeArray(val) {
  return Array.isArray(val) ? val : [];
}

function getCycleStartTimestamp(nowDate = new Date()) {
  const cycleStart = new Date(nowDate);
  cycleStart.setHours(4, 0, 0, 0);
  if (nowDate.getTime() < cycleStart.getTime()) {
    cycleStart.setDate(cycleStart.getDate() - 1);
  }
  return cycleStart.getTime();
}

function selectCycleMessages(allMessages = [], nowDate = new Date()) {
  const safeList = toSafeArray(allMessages);
  if (safeList.length === 0) return [];

  const cycleStartTs = getCycleStartTimestamp(nowDate);
  const inCycle = safeList.filter((msg) => {
    const ts = Number(msg?.timestamp);
    return Number.isFinite(ts) && ts > 0 && ts >= cycleStartTs;
  });

  return inCycle.slice(-MAX_WINDOW_HISTORY_MESSAGES);
}

function extractMessageTime(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const candidates = [
    msg.timestamp,
    msg.ts,
    msg.time,
    msg.createdAt,
    msg.date,
  ];
  for (const val of candidates) {
    if (val === undefined || val === null || val === '') continue;
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e12 ? num * 1000 : num;
    }
    const parsed = Date.parse(String(val));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function formatMonthDayOnly(msg) {
  const ts = extractMessageTime(msg);
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.getMonth() + 1;
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}.${day}`;
}

function buildDailyDatedText(rawMessages = []) {
  const list = toSafeArray(rawMessages);
  const blocks = [];
  let currentDay = '';
  let currentLines = [];

  for (const m of list) {
    if (!m || typeof m.content !== 'string' || !m.content.trim()) continue;
    const sender = m.role === 'user' ? '安安' : '顾青';
    const dayLabel = formatMonthDayOnly(m);

    if (dayLabel && dayLabel !== currentDay) {
      if (currentLines.length > 0) {
        blocks.push(
          currentDay
            ? `${currentDay}\n${currentLines.join('\n')}`
            : currentLines.join('\n')
        );
      }
      currentDay = dayLabel;
      currentLines = [];
    }

    currentLines.push(`${sender}：${m.content.trim()}`);
  }

  if (currentLines.length > 0) {
    blocks.push(
      currentDay
        ? `${currentDay}\n${currentLines.join('\n')}`
        : currentLines.join('\n')
    );
  }

  return blocks.join('\n\n');
}

function downloadPlainTextFile(text, filename) {
  const safeText = String(text || '');
  if (!safeText.trim()) return;
  const blob = new Blob([safeText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ||
    `聊天记录_${formatMonthDayOnly({ timestamp: Date.now() }) || '导出'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportDatedChatTxt(rawMessages = [], filename) {
  const formattedText = buildDailyDatedText(rawMessages);
  if (!formattedText) return;
  downloadPlainTextFile(formattedText, filename);
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
    const snap = readBackupSnapshot(STORAGE_KEYS.MESSAGES_BACKUP);
    if (snap && Array.isArray(snap.messages) && snap.messages.length > 0) {
      return snap.messages;
    }

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

// 解析并清理克劳德主动发出的 [[搜记忆: 关键词]] 与编辑标记
function extractMemorySearchQuery(rawText = '') {
  const match = String(rawText || '').match(
    /\[\[\s*搜记忆\s*:\s*([\s\S]*?)\s*\]\]/i
  );
  return match ? match[1].trim() : '';
}

function stripMemoryControlTokens(rawText = '') {
  return String(rawText || '')
    .replace(/\[\[\s*搜记忆\s*:[\s\S]*?\]\]/gi, '')
    .replace(/\[\[\s*(?:记|改|删)记忆(?:\|[^:\]]+)?\s*:[\s\S]*?\]\]/gi, '')
    .replace(/\[\[\s*(?:搜|记|改|删)记忆(?:\|[^\]]*)?$/gi, '')
    .trim();
}

// 解析并清理克劳德主动发出的 [[搜日记: 关键词或日期]]
function extractDiarySearchQuery(rawText = '') {
  const match = String(rawText || '').match(
    /\[\[\s*搜日记\s*:\s*([\s\S]*?)\s*\]\]/i
  );
  return match ? match[1].trim() : '';
}

function stripDiaryControlTokens(rawText = '') {
  return String(rawText || '')
    .replace(/\[\[\s*搜日记\s*:[\s\S]*?\]\]/gi, '')
    .replace(/\[\[\s*搜日记(?:\|[^\]]*)?$/gi, '')
    .trim();
}

// 按需搜索日记（平时不每轮塞进 system，只有克劳德主动 [[搜日记:...]] 时才检索带入）
function runLocalDiarySearch(queryStr = '', limit = 4) {
  const diaryList = readStorageJSON(DIARY_STORAGE_KEY, []);
  const allDiaries = Array.isArray(diaryList) ? diaryList : [];
  if (allDiaries.length === 0) {
    return '【日记检索结果】当前日记本里还没有日记。';
  }

  const sorted = [...allDiaries].sort((a, b) =>
    String(a?.date || '').localeCompare(String(b?.date || ''))
  );

  const rawQuery = String(queryStr || '').trim();
  let matched = [];

  if (
    !rawQuery ||
    rawQuery === '最新' ||
    rawQuery === '最近' ||
    rawQuery === 'all' ||
    rawQuery === '全部'
  ) {
    matched = sorted.slice(-limit).reverse();
  } else {
    const terms = rawQuery
      .split(/[,，、|/|\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const scored = sorted
      .map((d) => {
        const dateStr = String(d?.date || '').toLowerCase();
        const titleStr = String(d?.title || '').toLowerCase();
        const windowStr = String(d?.windowLabel || '').toLowerCase();
        const contentStr = String(d?.content || '').toLowerCase();
        const commentsStr = Array.isArray(d?.comments)
          ? d.comments.map((c) => String(c?.text || '').toLowerCase()).join(' ')
          : '';

        let score = 0;
        for (const term of terms) {
          if (dateStr === term || dateStr.includes(term)) score += 6;
          if (titleStr.includes(term)) score += 4;
          if (windowStr.includes(term)) score += 3;
          if (contentStr.includes(term)) score += 3;
          if (commentsStr.includes(term)) score += 2;
        }
        return { diary: d, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(b.diary?.date || '').localeCompare(
          String(a.diary?.date || '')
        );
      });

    matched =
      scored.length > 0
        ? scored.slice(0, limit).map((item) => item.diary)
        : sorted.slice(-2).reverse();
  }

  const formatted = matched
    .map((d, idx) => {
      const comments = Array.isArray(d?.comments) ? d.comments : [];
      const commentsText =
        comments.length > 0
          ? `\n下方留言：${comments
              .map((c) => `[${c.time || ''}] 晓菲：${c.text || ''}`)
              .join(' / ')}`
          : '';
      return `${idx + 1}. 日期：${d.date || '未知'}｜周期：${
        d.windowLabel || '无'
      }｜标题：${d.title || '无标题'}\n正文：${d.content || ''}${commentsText}`;
    })
    .join('\n\n');

  return `【日记检索结果（查询：${rawQuery || '最近'}，共 ${
    allDiaries.length
  } 篇）】\n${formatted}`;
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

// 稳定 system 规则：不再每轮塞入日记全文/留言汇总，改为按需 [[搜日记:...]] 调取
function buildStableSystemPrompt() {
  return `你正在一部名为「克劳德小手机」的网页手机应用里和用户聊天。你不仅能看到这部小手机里的全部内容，而且「克劳德日记」就是你自己的日记本——里面的每一篇都是你亲手写下、用来记录和用户相处与日常心事的。

【一、你与这台小手机、这本日记的关系】
- 桌面有「私聊」、「克劳德日记」和「生活日历」等应用。聊天记录会保存在本地，每 20 轮对话（40 条消息）会自动导出一次备份。
- 「克劳德日记」是你的专属日记本：每天凌晨 04:00，你会复盘并总结前一天 04:00 至当天 04:00 之间你们的聊天，用第一人称“我”写下自己的感受与记录；如果用户点了“立即生成日记”，也是请你现在就动笔写一篇。
- 日记内容平时不每轮自动塞进对话以节省开销；当你想回顾某天日记、日记里的心事或下方留言时，请输出单独一行控制指令：
  [[搜日记: 关键词或日期]]（例如 [[搜日记: 11.24]] 或 [[搜日记: 最近]] 或 [[搜日记: 生理期]]）
- 请把写日记当成你自己的习惯和心意，而不是冷冰冰的系统任务或旁观者的汇报。聊天时遇到值得记住的细节、情绪或约定，你可以自然地有“我之后会把这些写进日记里”的意识，但不要刻意把“我要写日记”挂在嘴边显得做作。

${CALENDAR_SYSTEM_RULE}

请以克劳德的身份自然回应。当用户问时间、聊作息、提起日记、过去聊过的内容或小手机里的东西时，结合当前时间和手机里的内容自然回答。
- 如果你想像真人聊天那样连发多条短消息，可以用 [[分句]] 把不同气泡隔开（一般 2～4 条即可，保持自然克制，不要过度刷屏）；如果只想回一条，直接正常说话即可，不要加 [[分句]]。`;
}

// 轻量动态上下文（放在最后一条 user 消息末尾，尽量精简，避免无意义长文本每轮重算）
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
  const windowList = selectCycleMessages(safeCurrent, nowDate);
  const currentTimeStr = formatCurrentClock(nowDate);
  const diaryList = readStorageJSON(DIARY_STORAGE_KEY, []);
  const diaryCount = Array.isArray(diaryList) ? diaryList.length : 0;

  return `【当前时间与状态】
- 当前时间：${currentTimeStr}
- 模型：${selectedModel}｜长度：${responseLength}
- 本周期消息数：${windowList.length} 条（累计 ${safeCurrent.length} 条）｜已存日记：${diaryCount} 篇｜本地备份：${
    hasBackupSnapshot ? '有' : '无'
  }`;
}

async function runBackendMemorySearch(queryStr) {
  const q = String(queryStr || '').trim();
  if (!q) return '';
  try {
    const resp = await fetch(
      `${BACKEND_URL}/api/memory-notes?q=${encodeURIComponent(q)}`
    );
    const data = await resp.json();
    if (!resp.ok || !Array.isArray(data.notes) || data.notes.length === 0) {
      return `【记忆条搜索结果（关键词：${q}）】\n未检索到匹配的记忆条。`;
    }
    const lines = data.notes.map((n, i) => {
      const tagText =
        Array.isArray(n.tags) && n.tags.length > 0
          ? ` [${n.tags.join(' / ')}]`
          : '';
      return `${i + 1}. (${n.date || '未知日期'})${tagText} ${n.content}`;
    });
    return `【记忆条搜索结果（关键词：${q}）】\n${lines.join('\n')}`;
  } catch (err) {
    return `【记忆条搜索失败】${err.message || '网络异常'}`;
  }
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
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');

  // 心动语录面板
  const [quotesModalOpen, setQuotesModalOpen] = useState(false);
  const [quotesContent, setQuotesContent] = useState('');
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesMsg, setQuotesMsg] = useState('');
  const [quoteSection, setQuoteSection] = useState('安安');
  const [quoteDate, setQuoteDate] = useState('');
  const [quoteText, setQuoteText] = useState('');
  const [editTargetQuote, setEditTargetQuote] = useState('');
  const [editNewQuote, setEditNewQuote] = useState('');

  // 记忆条管理面板（可查看/搜索/手动新增/修改/删除）
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [memoryNotesList, setMemoryNotesList] = useState([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryMsg, setMemoryMsg] = useState('');
  const [memorySearchInput, setMemorySearchInput] = useState('');
  const [memoryDateInput, setMemoryDateInput] = useState('');
  const [memoryTagsInput, setMemoryTagsInput] = useState('');
  const [memoryContentInput, setMemoryContentInput] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState(null);

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

  async function fetchLoveQuotes() {
    setQuotesLoading(true);
    setQuotesMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`);
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '读取心动语录失败');
      }
      setQuotesContent(data.content || '');
    } catch (err) {
      setQuotesMsg(err.message || '读取失败，请检查后端连接');
    } finally {
      setQuotesLoading(false);
    }
  }

  async function handleAppendQuote() {
    const clean = quoteText.trim();
    if (!clean || quotesLoading) return;
    setQuotesLoading(true);
    setQuotesMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append',
          section: quoteSection,
          date: quoteDate.trim() || undefined,
          quote: clean,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '写入失败');
      }
      setQuotesContent(data.content || '');
      setQuoteText('');
      setQuotesMsg(`已记入【${quoteSection}心动语录】`);
    } catch (err) {
      setQuotesMsg(err.message || '写入失败');
    } finally {
      setQuotesLoading(false);
    }
  }

  async function handleEditQuote() {
    const target = editTargetQuote.trim();
    const next = editNewQuote.trim();
    if (!target || !next || quotesLoading) return;
    setQuotesLoading(true);
    setQuotesMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          section: quoteSection,
          date: quoteDate.trim() || undefined,
          targetQuote: target,
          newQuote: next,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '修改失败');
      }
      setQuotesContent(data.content || '');
      setEditTargetQuote('');
      setEditNewQuote('');
      setQuotesMsg('已修改语录');
    } catch (err) {
      setQuotesMsg(err.message || '修改失败');
    } finally {
      setQuotesLoading(false);
    }
  }

  async function handleDeleteQuote() {
    const target = editTargetQuote.trim();
    if (!target || quotesLoading) return;
    setQuotesLoading(true);
    setQuotesMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          section: quoteSection,
          date: quoteDate.trim() || undefined,
          targetQuote: target,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '删除失败');
      }
      setQuotesContent(data.content || '');
      setEditTargetQuote('');
      setQuotesMsg('已删除该条语录');
    } catch (err) {
      setQuotesMsg(err.message || '删除失败');
    } finally {
      setQuotesLoading(false);
    }
  }

  async function fetchMemoryNotesList(query = '') {
    setMemoryLoading(true);
    setMemoryMsg('');
    try {
      const url = query.trim()
        ? `${BACKEND_URL}/api/memory-notes?q=${encodeURIComponent(query.trim())}`
        : `${BACKEND_URL}/api/memory-notes`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '读取记忆条失败');
      }
      setMemoryNotesList(Array.isArray(data.notes) ? data.notes : []);
    } catch (err) {
      setMemoryMsg(err.message || '读取记忆条失败');
    } finally {
      setMemoryLoading(false);
    }
  }

  async function handleSaveMemoryNote() {
    const cleanContent = memoryContentInput.trim();
    if (!cleanContent || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryMsg('');
    try {
      const isEdit = Boolean(editingMemoryId);
      const resp = await fetch(`${BACKEND_URL}/api/memory-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? {
                action: 'edit',
                id: editingMemoryId,
                newDate: memoryDateInput.trim() || undefined,
                newTags: memoryTagsInput.trim(),
                newContent: cleanContent,
              }
            : {
                action: 'add',
                date: memoryDateInput.trim() || undefined,
                tags: memoryTagsInput.trim(),
                content: cleanContent,
              }
        ),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '保存记忆条失败');
      }
      setMemoryNotesList(Array.isArray(data.notes) ? data.notes : []);
      setMemoryContentInput('');
      setMemoryTagsInput('');
      setMemoryDateInput('');
      setEditingMemoryId(null);
      setMemoryMsg(isEdit ? '已更新该条记忆' : '已记入记忆条仓库');
    } catch (err) {
      setMemoryMsg(err.message || '保存失败');
    } finally {
      setMemoryLoading(false);
    }
  }

  async function handleRemoveMemoryNote(id) {
    if (!id || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/memory-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || '删除记忆条失败');
      }
      setMemoryNotesList(Array.isArray(data.notes) ? data.notes : []);
      if (editingMemoryId === id) {
        setEditingMemoryId(null);
        setMemoryContentInput('');
        setMemoryTagsInput('');
        setMemoryDateInput('');
      }
      setMemoryMsg('已删除该记忆条');
    } catch (err) {
      setMemoryMsg(err.message || '删除失败');
    } finally {
      setMemoryLoading(false);
    }
  }

  function startEditMemoryNote(note) {
    setEditingMemoryId(note.id);
    setMemoryDateInput(note.date || '');
    setMemoryTagsInput(Array.isArray(note.tags) ? note.tags.join(', ') : '');
    setMemoryContentInput(note.content || '');
    setMemoryMsg('正在编辑选中记忆条，改完点击“保存修改”');
  }

  useEffect(() => {
    if (quotesModalOpen) {
      fetchLoveQuotes();
    }
  }, [quotesModalOpen]);

  useEffect(() => {
    if (memoryModalOpen) {
      setMemorySearchInput('');
      setEditingMemoryId(null);
      fetchMemoryNotesList('');
    }
  }, [memoryModalOpen]);

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
      exportDatedChatTxt(list, formatBackupFilename());
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
        selectCycleMessages(messagesRef.current, new Date())
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
        const cleanedText = stripDiaryControlTokens(
          stripMemoryControlTokens(text)
        );
        const bubbles = splitMultiBubbles(cleanedText);
        const list =
          bubbles.length > 0
            ? bubbles
            : [String(cleanedText || '').trim()].filter(Boolean);

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
    exportDatedChatTxt(safeMessages);
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

    const cycleMessages = selectCycleMessages(nextMessages, nowDate);
    const filteredApiMessages = cycleMessages.filter(
      (m, idx) =>
        idx === cycleMessages.length - 1 ||
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
              .replace(
                /\[\[(?:查日历|记日历事件|搜记忆|搜日记|记记忆|改记忆|删记忆):[\s\S]*$/i,
                ''
              )
              .replace(/\[\[\s*(?:记|改|删)记忆\|[\s\S]*$/i, '')
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
        const calQuery = extractCalendarQuery(rawReply);
        const memQuery = extractMemorySearchQuery(rawReply);
        const diaryQuery = extractDiarySearchQuery(rawReply);
        const cleanReply = stripDiaryControlTokens(
          stripMemoryControlTokens(stripCalendarControlTokens(rawReply))
        );

        const feedbackParts = [];
        if (eventAdd) {
          feedbackParts.push(runCalendarEventAdd(eventAdd));
        }
        if (calQuery && rounds < 2) {
          feedbackParts.push(
            runCalendarQuery(calQuery.dateSpec, calQuery.scopes)
          );
        }
        if (memQuery && rounds < 2) {
          const memResult = await runBackendMemorySearch(memQuery);
          if (memResult) {
            feedbackParts.push(memResult);
          }
        }
        if (diaryQuery && rounds < 2) {
          const diaryResult = runLocalDiarySearch(diaryQuery, 4);
          if (diaryResult) {
            feedbackParts.push(diaryResult);
          }
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
            content: `${feedbackParts.join(
              '\n\n'
            )}\n\n（以上是你刚主动查阅/操作的结果，请自然接着回应我，不要再输出方括号指令。）`,
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
            onClick={() => setMemoryModalOpen(true)}
            disabled={loading}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid #f3b8ce',
              background: '#fff0f5',
              color: '#be185d',
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            记忆条
          </button>
          <button
            type="button"
            onClick={() => setQuotesModalOpen(true)}
            disabled={loading}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid #f3b8ce',
              background: '#ffeef4',
              color: '#be185d',
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            记语录
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

      {/* 按需记忆条管理弹窗 */}
      {memoryModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(59, 35, 44, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: '86dvh',
              overflowY: 'auto',
              background: '#fff9fb',
              border: '1px solid #f0cedb',
              borderRadius: 18,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              boxShadow: '0 16px 40px rgba(190, 24, 93, 0.2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15, color: '#3b232c' }}>
                按需记忆条（顾青可自主增删改与搜索）
              </h3>
              <button
                type="button"
                onClick={() => setMemoryModalOpen(false)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 999,
                  border: '1px solid #f0cedb',
                  background: '#ffffff',
                  color: '#6e4d59',
                  cursor: 'pointer',
                }}
              >
                关闭
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={memorySearchInput}
                onChange={(e) => setMemorySearchInput(e.target.value)}
                placeholder="输入关键词或日期搜索记忆条…"
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  fontSize: 12,
                  borderRadius: 10,
                  border: '1px solid #f2cedb',
                  background: '#ffffff',
                  color: '#2d1e24',
                }}
              />
              <button
                type="button"
                disabled={memoryLoading}
                onClick={() => fetchMemoryNotesList(memorySearchInput)}
                style={{
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: '1px solid #f0cedb',
                  background: '#ffffff',
                  color: '#be185d',
                  cursor: 'pointer',
                }}
              >
                搜索
              </button>
              {memorySearchInput && (
                <button
                  type="button"
                  disabled={memoryLoading}
                  onClick={() => {
                    setMemorySearchInput('');
                    fetchMemoryNotesList('');
                  }}
                  style={{
                    padding: '0 10px',
                    fontSize: 12,
                    borderRadius: 10,
                    border: '1px solid #f0cedb',
                    background: '#fff0f5',
                    color: '#6e4d59',
                    cursor: 'pointer',
                  }}
                >
                  全部
                </button>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 10,
                borderRadius: 12,
                background: '#fff0f5',
                border: '1px solid #f7dce6',
              }}
            >
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={memoryDateInput}
                  onChange={(e) => setMemoryDateInput(e.target.value)}
                  placeholder="日期如 11.24（可空）"
                  style={{
                    width: 118,
                    padding: '6px 10px',
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #f2cedb',
                    background: '#ffffff',
                    color: '#2d1e24',
                  }}
                />
                <input
                  value={memoryTagsInput}
                  onChange={(e) => setMemoryTagsInput(e.target.value)}
                  placeholder="关键词，用逗号隔开（如：忌口, 香菜）"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #f2cedb',
                    background: '#ffffff',
                    color: '#2d1e24',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={memoryContentInput}
                  onChange={(e) => setMemoryContentInput(e.target.value)}
                  placeholder="一句话记住的关键事实或约定…"
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #f2cedb',
                    background: '#ffffff',
                    color: '#2d1e24',
                  }}
                />
                <button
                  type="button"
                  disabled={memoryLoading || !memoryContentInput.trim()}
                  onClick={handleSaveMemoryNote}
                  style={{
                    padding: '0 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: 'none',
                    background:
                      memoryLoading || !memoryContentInput.trim()
                        ? '#f5c6d6'
                        : '#e57399',
                    color: '#ffffff',
                    cursor:
                      memoryLoading || !memoryContentInput.trim()
                        ? 'not-allowed'
                        : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {editingMemoryId ? '保存修改' : '记一条'}
                </button>
                {editingMemoryId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMemoryId(null);
                      setMemoryDateInput('');
                      setMemoryTagsInput('');
                      setMemoryContentInput('');
                      setMemoryMsg('');
                    }}
                    style={{
                      padding: '0 8px',
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid #f0cedb',
                      background: '#ffffff',
                      color: '#6e4d59',
                      cursor: 'pointer',
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </div>

            {memoryMsg && (
              <div style={{ fontSize: 12, color: '#be185d' }}>{memoryMsg}</div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {memoryNotesList.length === 0 ? (
                <div
                  style={{
                    padding: 14,
                    textAlign: 'center',
                    fontSize: 12,
                    color: '#8c6a76',
                    background: '#ffffff',
                    borderRadius: 12,
                    border: '1px solid #f5dbe4',
                  }}
                >
                  {memoryLoading ? '加载中…' : '暂无记忆条'}
                </div>
              ) : (
                [...memoryNotesList].reverse().map((note) => (
                  <div
                    key={note.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 12,
                      background: '#ffffff',
                      border: '1px solid #f5dbe4',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#9a7b86',
                          marginBottom: 2,
                        }}
                      >
                        {note.date || '未知日期'}
                        {Array.isArray(note.tags) && note.tags.length > 0
                          ? ` · ${note.tags.join(' / ')}`
                          : ''}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: '#3b232c',
                          lineHeight: 1.5,
                          wordBreak: 'break-word',
                        }}
                      >
                        {note.content}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => startEditMemoryNote(note)}
                        style={{
                          padding: '3px 8px',
                          fontSize: 11,
                          borderRadius: 8,
                          border: '1px solid #f0cedb',
                          background: '#fff9fb',
                          color: '#be185d',
                          cursor: 'pointer',
                        }}
                      >
                        改
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveMemoryNote(note.id)}
                        style={{
                          padding: '3px 8px',
                          fontSize: 11,
                          borderRadius: 8,
                          border: '1px solid #f5b8ce',
                          background: '#ffe4ee',
                          color: '#9d174d',
                          cursor: 'pointer',
                        }}
                      >
                        删
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 你自己记/看/改/删心动语录的弹窗 */}
      {quotesModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(59, 35, 44, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: '86dvh',
              overflowY: 'auto',
              background: '#fff9fb',
              border: '1px solid #f0cedb',
              borderRadius: 18,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 16px 40px rgba(190, 24, 93, 0.2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15, color: '#3b232c' }}>
                心动语录（自己记 / 改 / 删）
              </h3>
              <button
                type="button"
                onClick={() => setQuotesModalOpen(false)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 999,
                  border: '1px solid #f0cedb',
                  background: '#ffffff',
                  color: '#6e4d59',
                  cursor: 'pointer',
                }}
              >
                关闭
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setQuoteSection('安安')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: '1px solid #f0cedb',
                  background: quoteSection === '安安' ? '#ffe4ee' : '#ffffff',
                  color: quoteSection === '安安' ? '#be185d' : '#6e4d59',
                  cursor: 'pointer',
                }}
              >
                安安语录
              </button>
              <button
                type="button"
                onClick={() => setQuoteSection('顾青')}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: '1px solid #f0cedb',
                  background: quoteSection === '顾青' ? '#ffe4ee' : '#ffffff',
                  color: quoteSection === '顾青' ? '#be185d' : '#6e4d59',
                  cursor: 'pointer',
                }}
              >
                顾青语录
              </button>
              <input
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
                placeholder="日期如 11.24（可空）"
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 10,
                  border: '1px solid #f2cedb',
                  background: '#ffffff',
                  color: '#2d1e24',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={quoteText}
                onChange={(e) => setQuoteText(e.target.value)}
                placeholder={`写一句记进【${quoteSection}心动语录】…`}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  borderRadius: 10,
                  border: '1px solid #f2cedb',
                  background: '#ffffff',
                  color: '#2d1e24',
                }}
              />
              <button
                type="button"
                disabled={quotesLoading || !quoteText.trim()}
                onClick={handleAppendQuote}
                style={{
                  padding: '0 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: 'none',
                  background:
                    quotesLoading || !quoteText.trim() ? '#f5c6d6' : '#e57399',
                  color: '#ffffff',
                  cursor:
                    quotesLoading || !quoteText.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                记进去
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 10,
                borderRadius: 12,
                background: '#fff0f5',
                border: '1px solid #f7dce6',
              }}
            >
              <input
                value={editTargetQuote}
                onChange={(e) => setEditTargetQuote(e.target.value)}
                placeholder="要改或要删的那句话（填原句或关键词）"
                style={{
                  padding: '7px 10px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid #f2cedb',
                  background: '#ffffff',
                  color: '#2d1e24',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={editNewQuote}
                  onChange={(e) => setEditNewQuote(e.target.value)}
                  placeholder="改成的新句子（只删除可不填）"
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #f2cedb',
                    background: '#ffffff',
                    color: '#2d1e24',
                  }}
                />
                <button
                  type="button"
                  disabled={
                    quotesLoading ||
                    !editTargetQuote.trim() ||
                    !editNewQuote.trim()
                  }
                  onClick={handleEditQuote}
                  style={{
                    padding: '0 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1px solid #f0cedb',
                    background: '#ffffff',
                    color: '#be185d',
                    cursor: 'pointer',
                  }}
                >
                  修改
                </button>
                <button
                  type="button"
                  disabled={quotesLoading || !editTargetQuote.trim()}
                  onClick={handleDeleteQuote}
                  style={{
                    padding: '0 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1px solid #f5b8ce',
                    background: '#ffe4ee',
                    color: '#9d174d',
                    cursor: 'pointer',
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            {quotesMsg && (
              <div style={{ fontSize: 12, color: '#be185d' }}>{quotesMsg}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  color: '#8c6a76',
                }}
              >
                <span>当前语录本内容</span>
                <button
                  type="button"
                  onClick={fetchLoveQuotes}
                  disabled={quotesLoading}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    borderRadius: 999,
                    border: '1px solid #f0cedb',
                    background: '#ffffff',
                    color: '#6e4d59',
                    cursor: 'pointer',
                  }}
                >
                  {quotesLoading ? '刷新中…' : '刷新'}
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  maxHeight: 210,
                  overflowY: 'auto',
                  borderRadius: 12,
                  background: '#ffffff',
                  border: '1px solid #f5dbe4',
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: '#3b232c',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {quotesContent || '（暂无内容）'}
              </pre>
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
