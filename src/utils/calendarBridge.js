const MOOD_MAP = {
  happy: { kaomoji: "ʚ˃ ᵕ ˂ɞ", label: "开心/幸福" },
  cozy: { kaomoji: "ᯠ_   ̫ _ᯄ", label: "舒服/放松" },
  sad: { kaomoji: "˃ ˄ ˂̥̥", label: "伤心/委屈" },
  down: { kaomoji: "ᗜ ‸ ᗜ", label: "不开心/闷闷的" },
  shy: { kaomoji: "^>⸝⸝⸝⸝<^", label: "害羞/心动" },
};

const QUERY_REGEX = /\[\[查日历:\s*([^\],]+?)\s*,\s*([^\]]+?)\]\]/i;
const EVENT_ADD_REGEX =
  /\[\[记日历事件:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*,\s*([^,\]]+?)\s*,\s*([^\]]+?)\]\]/i;
const VALID_TAGS = new Set(["重要", "工作", "生活", "纪念"]);

export const CALENDAR_SYSTEM_RULE = `【小手机日历功能说明】
你的小手机里有一个「生活日历」应用，记录了：
1. 每日多次带时间的心情（5款颜文字：ʚ˃ ᵕ ˂ɞ 开心/幸福、ᯠ_   ̫ _ᯄ 舒服/放松、˃ ˄ ˂̥̥ 伤心/委屈、ᗜ ‸ ᗜ 不开心/闷闷的、^>⸝⸝⸝⸝<^ 害羞/心动，可带备注）；
2. 重要事件（带标签与标题）；
3. 生理期标记（以及基于历史记录推算的周期预测，仅供参考）。

日历不会在每次对话中自动全部展开。当对方提到今天/某天/心情/经期/安排，或者你自己想了解某天状态，或者收到日历变动提醒时，由你自己决定要不要去看、看哪一天、看哪一类。
- 如果决定不看或不说话，请直接回复 [PASS]。
- 如果想查日历，请在回复末尾单独写一行（不要解释这行指令）：
  [[查日历: YYYY-MM-DD, scope]]
  （YYYY-MM-DD 可写具体日期，也可用 recent 看最近有记录的日子；scope 可写 mood、period、events 或 all，支持用 / 组合如 mood/period）
- 如果你想自己往日历里添加一条「事件」（只限事件，不要动心情和生理期；请保持克制，同一天顶多记一两条），请在回复末尾单独写一行（不要解释这行指令）：
  [[记日历事件: YYYY-MM-DD, 标签, 标题]]
  （标签可选：重要、工作、生活、纪念；标题简短清晰）`;

export function stripCalendarControlTokens(text = "") {
  return String(text || "")
    .replace(QUERY_REGEX, "")
    .replace(EVENT_ADD_REGEX, "")
    .trim();
}

export function extractCalendarQuery(text = "") {
  const match = text.match(QUERY_REGEX);
  if (!match) return null;

  const dateSpec = match[1].trim();
  const scopes = match[2]
    .trim()
    .toLowerCase()
    .split(/[\/|+]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const cleanText = stripCalendarControlTokens(text);
  return {
    dateSpec,
    scopes: scopes.length ? scopes : ["all"],
    cleanText,
  };
}

export function extractCalendarEventAdd(text = "") {
  const match = text.match(EVENT_ADD_REGEX);
  if (!match) return null;

  const dateKey = match[1].trim();
  const rawTag = match[2].trim();
  const tag = VALID_TAGS.has(rawTag) ? rawTag : "重要";
  const title = match[3].trim().slice(0, 60);

  if (!title) return null;

  return {
    dateKey,
    tag,
    title,
    cleanText: stripCalendarControlTokens(text),
  };
}

export function isPassResponse(text = "") {
  return text.trim() === "[PASS]" || text.trim().startsWith("[PASS]");
}

function readCalendarData() {
  try {
    const raw =
      localStorage.getItem("my_claude_calendar_v2") ||
      localStorage.getItem("my_claude_calendar_v1");
    if (!raw) return { days: {}, periodDays: [] };
    const parsed = JSON.parse(raw);
    return {
      days: parsed.days || {},
      periodDays: Array.isArray(parsed.periodDays) ? parsed.periodDays : [],
    };
  } catch (err) {
    console.error("读取日历存储失败:", err);
    return { days: {}, periodDays: [] };
  }
}

function writeCalendarData(nextData) {
  localStorage.setItem("my_claude_calendar_v2", JSON.stringify(nextData));
}

export function runCalendarEventAdd({ dateKey, tag = "重要", title }) {
  const current = readCalendarData();
  const oldDay = current.days[dateKey] || { moodLogs: [], events: [] };
  const oldEvents = Array.isArray(oldDay.events) ? oldDay.events : [];

  const duplicate = oldEvents.some(
    (ev) => ev.title === title && ev.tag === tag
  );
  if (duplicate) {
    return `日历事件已存在：${dateKey} [${tag}] ${title}`;
  }

  const nextEvents = [...oldEvents, { title, tag }];
  const nextData = {
    ...current,
    days: {
      ...current.days,
      [dateKey]: {
        ...oldDay,
        moodLogs: Array.isArray(oldDay.moodLogs) ? oldDay.moodLogs : [],
        events: nextEvents,
      },
    },
  };

  writeCalendarData(nextData);
  window.dispatchEvent(
    new CustomEvent("calendar:updated", {
      detail: { date: dateKey, action: "event", source: "claude" },
    })
  );

  return `已成功写入日历事件：${dateKey} [${tag}] ${title}`;
}

export function runCalendarQuery(dateSpec, scopes = ["all"]) {
  const { days, periodDays } = readCalendarData();
  const periodSet = new Set(periodDays);

  const keys =
    dateSpec === "recent"
      ? [...new Set([...Object.keys(days), ...periodDays])].sort().slice(-10)
      : [dateSpec];

  if (!keys.length) {
    return `日历查询结果（${dateSpec}）：目前没有相关记录。`;
  }

  const hasAll = scopes.includes("all");
  const wantMood = hasAll || scopes.includes("mood");
  const wantPeriod = hasAll || scopes.includes("period");
  const wantEvents = hasAll || scopes.includes("events");

  const lines = keys.map((key) => {
    const day = days[key] || { moodLogs: [], events: [] };
    const parts = [`日期 ${key}`];

    if (wantMood) {
      const logs = Array.isArray(day.moodLogs) ? day.moodLogs : [];
      if (logs.length) {
        const text = logs
          .map((item) => {
            const m = MOOD_MAP[item.moodId] || { kaomoji: "", label: item.moodId };
            return `${item.time || "--:--"} ${m.kaomoji}(${m.label})${item.note ? `：${item.note}` : ""}`;
          })
          .join("；");
        parts.push(`心情 -> ${text}`);
      } else {
        parts.push("心情 -> 无记录");
      }
    }

    if (wantPeriod) {
      parts.push(`生理期 -> ${periodSet.has(key) ? "已标记经期" : "未标记"}`);
    }

    if (wantEvents) {
      const events = Array.isArray(day.events) ? day.events : [];
      if (events.length) {
        parts.push(`事件 -> ${events.map((e) => `[${e.tag}] ${e.title}`).join("、")}`);
      } else {
        parts.push("事件 -> 无");
      }
    }

    return parts.join(" | ");
  });

  return `【日历查阅结果】\n${lines.join("\n")}`;
}
