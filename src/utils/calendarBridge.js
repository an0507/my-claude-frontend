import { notifyCalendarUpdated } from "../components/CalendarApp";

const CALENDAR_STORAGE_KEY = "my_claude_calendar_v2";
const LEGACY_CALENDAR_STORAGE_KEY = "my_claude_calendar_v1";

const MOOD_LABEL_MAP = {
  happy: "开心/幸福 (ʚ˃ ᵕ ˂ɞ)",
  cozy: "舒服/放松 (ᯠ_   ̫ _ᯄ)",
  sad: "伤心/委屈 (˃ ˄ ˂̥̥)",
  down: "不开心/闷闷的 (ᗜ ‸ ᗜ)",
  shy: "害羞/心动 (^>⸝⸝⸝⸝<^)",
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function shiftDateKey(dateKey, offsetDays) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + offsetDays);
  return formatDateKey(dt);
}

function readCalendarRaw() {
  try {
    const raw =
      localStorage.getItem(CALENDAR_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_CALENDAR_STORAGE_KEY);
    if (!raw) return { days: {}, periodDays: [] };
    const parsed = JSON.parse(raw);
    return {
      days: parsed && typeof parsed.days === "object" && parsed.days ? parsed.days : {},
      periodDays: Array.isArray(parsed?.periodDays) ? parsed.periodDays : [],
    };
  } catch (err) {
    console.error("读取日历存储失败:", err);
    return { days: {}, periodDays: [] };
  }
}

function writeCalendarRaw(nextRaw) {
  localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(nextRaw));
}

function normalizeDayForRead(rawDay) {
  if (!rawDay || typeof rawDay !== "object") {
    return { moodLogs: [], events: [] };
  }
  if (Array.isArray(rawDay.moodLogs)) {
    return {
      moodLogs: rawDay.moodLogs,
      events: Array.isArray(rawDay.events) ? rawDay.events : [],
    };
  }
  if (rawDay.mood) {
    return {
      moodLogs: [
        {
          id: "legacy",
          time: "--:--",
          moodId: rawDay.mood,
          note: rawDay.note || "",
        },
      ],
      events: Array.isArray(rawDay.events) ? rawDay.events : [],
    };
  }
  return {
    moodLogs: [],
    events: Array.isArray(rawDay.events) ? rawDay.events : [],
  };
}

function formatSingleDaySummary(dateKey, rawData) {
  const day = normalizeDayForRead(rawData.days?.[dateKey]);
  const isPeriod = (rawData.periodDays || []).includes(dateKey);

  const lines = [`【${dateKey} 日历记录】`];
  lines.push(`- 生理期标记：${isPeriod ? "已标为经期" : "未标记"}`);

  if (day.moodLogs.length > 0) {
    const sorted = [...day.moodLogs].sort((a, b) =>
      String(a.time || "").localeCompare(String(b.time || ""))
    );
    lines.push(`- 心情记录（共 ${sorted.length} 条）：`);
    sorted.forEach((m) => {
      const moodText = MOOD_LABEL_MAP[m.moodId] || m.moodId || "未知心情";
      const noteText = m.note ? `｜备注：${m.note}` : "";
      lines.push(`  · [${m.time || "--:--"}] ${moodText}${noteText}`);
    });
  } else {
    lines.push("- 心情记录：无");
  }

  if (day.events.length > 0) {
    lines.push(`- 重要事件（共 ${day.events.length} 条）：`);
    day.events.forEach((ev) => {
      const author = ev?.source === "claude" || ev?.createdBy === "小克" ? "小克·蓝" : "我·粉";
      lines.push(`  · [${ev.tag || "事件"}·${author}] ${ev.title || ""}`);
    });
  } else {
    lines.push("- 重要事件：无");
  }

  return lines.join("\n");
}

function resolveDateKeys(dateSpec) {
  const todayKey = formatDateKey(new Date());
  const raw = String(dateSpec || "").trim();

  if (!raw || raw === "今天" || raw === "今日") {
    return [todayKey];
  }
  if (raw === "昨天" || raw === "昨日") {
    return [shiftDateKey(todayKey, -1)];
  }
  if (raw === "明天" || raw === "明日") {
    return [shiftDateKey(todayKey, 1)];
  }
  if (raw === "近7天" || raw === "最近7天" || raw === "本周") {
    return Array.from({ length: 7 }, (_, i) => shiftDateKey(todayKey, i - 3));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return [raw];
  }

  const rangeMatch = raw.match(/^(\d{4}-\d{2}-\d{2})\s*(?:~|至|到|\.\.)\s*(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    const startKey = rangeMatch[1];
    const endKey = rangeMatch[2];
    const keys = [];
    let cur = startKey;
    let guard = 0;
    while (cur <= endKey && guard < 31) {
      keys.push(cur);
      cur = shiftDateKey(cur, 1);
      guard += 1;
    }
    return keys.length ? keys : [todayKey];
  }

  return [todayKey];
}

export function runCalendarQuery(dateSpec = "今天", scopes = ["all"]) {
  const data = readCalendarRaw();
  const keys = resolveDateKeys(dateSpec);
  const normalizedScopes = (Array.isArray(scopes) ? scopes : [scopes])
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);

  const wantAll =
    normalizedScopes.length === 0 ||
    normalizedScopes.includes("all") ||
    normalizedScopes.includes("全部");
  const wantMood =
    wantAll || normalizedScopes.includes("mood") || normalizedScopes.includes("心情");
  const wantEvents =
    wantAll || normalizedScopes.includes("events") || normalizedScopes.includes("事件");
  const wantPeriod =
    wantAll ||
    normalizedScopes.includes("period") ||
    normalizedScopes.includes("经期") ||
    normalizedScopes.includes("生理期");

  const blocks = keys.map((key) => {
    const day = normalizeDayForRead(data.days?.[key]);
    const isPeriod = (data.periodDays || []).includes(key);
    const parts = [`【${key}】`];

    if (wantPeriod) {
      parts.push(`- 生理期：${isPeriod ? "已标记" : "未标记"}`);
    }
    if (wantMood) {
      if (day.moodLogs.length > 0) {
        const sorted = [...day.moodLogs].sort((a, b) =>
          String(a.time || "").localeCompare(String(b.time || ""))
        );
        parts.push(
          `- 心情：${sorted
            .map((m) => {
              const label = MOOD_LABEL_MAP[m.moodId] || m.moodId;
              return `[${m.time || "--:--"}] ${label}${m.note ? `（${m.note}）` : ""}`;
            })
            .join("；")}`
        );
      } else {
        parts.push("- 心情：无记录");
      }
    }
    if (wantEvents) {
      if (day.events.length > 0) {
        parts.push(
          `- 事件：${day.events
            .map((ev) => {
              const author = ev?.source === "claude" || ev?.createdBy === "小克" ? "小克·蓝" : "我·粉";
              return `[${ev.tag || "事件"}·${author}] ${ev.title}`;
            })
            .join("；")}`
        );
      } else {
        parts.push("- 事件：无");
      }
    }

    return parts.join("\n");
  });

  if (wantPeriod && data.periodDays.length > 0) {
    const recentPeriods = [...new Set(data.periodDays)].sort().slice(-10);
    blocks.push(`【近期已标记经期日期】${recentPeriods.join(", ")}`);
  }

  return `[日历查阅结果]\n${blocks.join("\n\n")}`;
}

export function extractCalendarQuery(text = "") {
  const regex = /\[\[\s*查日历\s*:\s*([^\]]+)\s*\]\]/i;
  const match = String(text || "").match(regex);
  if (!match) return null;

  const rawInner = String(match[1] || "").trim();
  const parts = rawInner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const dateSpec = parts[0] || "今天";
  const scopes = parts.length > 1 ? parts.slice(1) : ["all"];
  const cleanText = String(text || "").replace(regex, "").trim();

  return { dateSpec, scopes, cleanText };
}

export function extractCalendarEventAdd(text = "") {
  const regex = /\[\[\s*记日历事件\s*:\s*([^\]]+)\s*\]\]/gi;
  const matches = [...String(text || "").matchAll(regex)];
  if (!matches.length) return null;

  const allowedTags = ["重要", "工作", "生活", "纪念"];
  const items = [];

  for (const m of matches) {
    const parts = String(m[1] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;

    let dateKey = "";
    let tag = "重要";
    let title = "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
      dateKey = parts[0];
      if (parts.length >= 3) {
        tag = parts[1];
        title = parts.slice(2).join("，");
      } else {
        title = parts[1];
      }
    } else {
      dateKey = formatDateKey(new Date());
      if (parts.length >= 2) {
        tag = parts[0];
        title = parts.slice(1).join("，");
      } else {
        title = parts[0];
      }
    }

    if (!allowedTags.includes(tag)) {
      tag = "重要";
    }

    if (title) {
      items.push({ dateKey, tag, title });
    }
  }

  if (!items.length) return null;

  const cleanText = String(text || "")
    .replace(regex, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { items, cleanText };
}

export function runCalendarEventAdd(eventAddPayload) {
  const list = Array.isArray(eventAddPayload?.items)
    ? eventAddPayload.items
    : eventAddPayload
    ? [eventAddPayload]
    : [];

  if (!list.length) {
    return "[日历事件写入结果：参数不完整，未能写入]";
  }

  const raw = readCalendarRaw();
  const days = { ...(raw.days || {}) };
  const results = [];

  for (const { dateKey, tag, title } of list) {
    const current = days[dateKey] || {};
    const moodLogs = Array.isArray(current.moodLogs) ? current.moodLogs : [];
    const events = Array.isArray(current.events) ? current.events : [];

    const nextEvents = [
      ...events,
      { title, tag, source: "claude", createdBy: "小克" },
    ];

    days[dateKey] = {
      ...current,
      moodLogs,
      events: nextEvents,
    };

    results.push(`${dateKey} [${tag}] ${title}`);
  }

  const nextRaw = {
    ...raw,
    days,
    periodDays: Array.isArray(raw.periodDays) ? raw.periodDays : [],
  };

  writeCalendarRaw(nextRaw);
  const lastDate = list[list.length - 1].dateKey;
  notifyCalendarUpdated({ date: lastDate, action: "event", source: "claude" });

  return `[日历事件写入结果：已成功添加 ${results.length} 条事件（小克专属蓝色标识）：${results.join("；")}]`;
}

export function stripCalendarControlTokens(text = "") {
  return String(text || "")
    .replace(/\[\[\s*查日历\s*:[^\]]*\]\]/gi, "")
    .replace(/\[\[\s*记日历事件\s*:[^\]]*\]\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isPassResponse(text = "") {
  const cleaned = stripCalendarControlTokens(text).trim();
  return /^\[?\s*PASS\s*\]?$/i.test(cleaned);
}

export function buildTodayCalendarBrief() {
  const data = readCalendarRaw();
  const todayKey = formatDateKey(new Date());
  return formatSingleDaySummary(todayKey, data);
}

export const CALENDAR_SYSTEM_RULE = `【生活日历工具说明】
小手机里有「生活日历」，里面记录着用户的每日心情、重要事件和生理期标记。
- 默认情况下不需要把整本日历塞进每次对话；当你需要查看某天/某段时间的记录时，可以在回复中输出单独一行控制指令：
  [[查日历: YYYY-MM-DD, scope]]
  其中日期也可以写 今天、昨天、明天、近7天 或 YYYY-MM-DD~YYYY-MM-DD；scope 可选 all、mood、events、period（可逗号分隔多个）。
- 当你觉得有值得记下来的约定、纪念日、日程或重要事情时，也可以自主往日历里添加“事件”（注意：只能添加事件，不能修改用户的心情记录或生理期标记）：
  [[记日历事件: YYYY-MM-DD, 标签, 标题]]
  其中标签仅限：重要、工作、生活、纪念。如需一次记多条事件，可输出多行 [[记日历事件: ...]]。
  你写入的事件在日历上会显示为蓝色，用户自己添加的事件显示为粉色。
- 指令会被系统自动执行并从气泡中隐藏，不要向用户暴露 [[查日历:...]] 或 [[记日历事件:...]] 这种原始语法。`;
