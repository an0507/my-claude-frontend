import { useEffect, useMemo, useState } from "react";

const MOODS = [
  { id: "happy", kaomoji: "ʚ˃ ᵕ ˂ɞ", label: "开心/幸福", bg: "#fff3e6", color: "#9a5b13" },
  { id: "cozy", kaomoji: "ᯠ_   ̫ _ᯄ", label: "舒服/放松", bg: "#e8f6f0", color: "#236b52" },
  { id: "sad", kaomoji: "˃ ˄ ˂̥̥", label: "伤心/委屈", bg: "#edf2fb", color: "#3b5998" },
  { id: "down", kaomoji: "ᗜ ‸ ᗜ", label: "不开心/闷闷的", bg: "#f2eff5", color: "#5e546b" },
  { id: "shy", kaomoji: "^>⸝⸝⸝⸝<^", label: "害羞/心动", bg: "#fdecef", color: "#a83e5b" },
];

const STORAGE_KEY = "my_claude_calendar_v2";

export function notifyCalendarUpdated(detail) {
  window.dispatchEvent(new CustomEvent("calendar:updated", { detail }));
}

function getEventColorStyle(ev) {
  if (ev?.source === "claude") {
    return {
      bg: "#e6f2ff",
      color: "#1d5fa7",
      border: "1px solid #bddcff",
      badge: "小克",
    };
  }
  return {
    bg: "#fde8f0",
    color: "#b02a5b",
    border: "1px solid #f7c5d8",
    badge: "我",
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getCurrentTimeHHMM() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function parseDateKey(key) {
  const [y, m, day] = key.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function shiftDays(d, offset) {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + offset);
  return next;
}

function dayDiff(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

function calcCycle(periodDays) {
  const sorted = [...new Set(periodDays)].sort();
  if (!sorted.length) {
    return { predicted: new Set(), cycleLen: 28, periodLen: 5, lastStart: null };
  }

  const episodes = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(parseDateKey(cur[cur.length - 1]), parseDateKey(sorted[i])) <= 2) {
      cur.push(sorted[i]);
    } else {
      episodes.push(cur);
      cur = [sorted[i]];
    }
  }
  episodes.push(cur);

  const periodLen =
    Math.round(
      episodes.reduce(
        (acc, ep) =>
          acc + Math.max(1, dayDiff(parseDateKey(ep[0]), parseDateKey(ep[ep.length - 1])) + 1),
        0
      ) / episodes.length
    ) || 5;

  let cycleLen = 28;
  if (episodes.length >= 2) {
    const gaps = [];
    for (let i = 1; i < episodes.length; i++) {
      const gap = dayDiff(parseDateKey(episodes[i - 1][0]), parseDateKey(episodes[i][0]));
      if (gap >= 18 && gap <= 45) gaps.push(gap);
    }
    if (gaps.length) {
      cycleLen = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }
  }

  const lastEp = episodes[episodes.length - 1];
  const lastStart = parseDateKey(lastEp[0]);
  const actualSet = new Set(sorted);
  const predicted = new Set();

  for (let c = 1; c <= 3; c++) {
    const start = shiftDays(lastStart, cycleLen * c);
    for (let d = 0; d < periodLen; d++) {
      const key = toDateKey(shiftDays(start, d));
      if (!actualSet.has(key)) predicted.add(key);
    }
  }

  return { predicted, cycleLen, periodLen, lastStart: lastEp[0] };
}

function normalizeDayRecord(rawDay) {
  if (!rawDay) return { moodLogs: [], events: [] };
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
          id: `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          time: getCurrentTimeHHMM(),
          moodId: rawDay.mood,
          note: rawDay.note || "",
        },
      ],
      events: Array.isArray(rawDay.events) ? rawDay.events : [],
    };
  }
  return { moodLogs: [], events: Array.isArray(rawDay.events) ? rawDay.events : [] };
}

function loadData() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem("my_claude_calendar_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      const normalizedDays = {};
      Object.entries(parsed.days || {}).forEach(([k, v]) => {
        normalizedDays[k] = normalizeDayRecord(v);
      });
      return {
        days: normalizedDays,
        periodDays: Array.isArray(parsed.periodDays) ? parsed.periodDays : [],
      };
    }
  } catch (e) {
    console.error(e);
  }
  return { days: {}, periodDays: [] };
}

export default function CalendarApp({ onBackHome }) {
  const today = useMemo(() => new Date(), []);
  const [data, setData] = useState(loadData);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedKey, setSelectedKey] = useState(() => toDateKey(today));

  const [editingLogId, setEditingLogId] = useState(null);
  const [moodDraft, setMoodDraft] = useState("happy");
  const [timeDraft, setTimeDraft] = useState(getCurrentTimeHHMM);
  const [noteDraft, setNoteDraft] = useState("");

  const [eventInput, setEventInput] = useState("");
  const [eventTag, setEventTag] = useState("重要");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const resetMoodForm = () => {
    setEditingLogId(null);
    setMoodDraft("happy");
    setTimeDraft(getCurrentTimeHHMM());
    setNoteDraft("");
  };

  useEffect(() => {
    resetMoodForm();
  }, [selectedKey]);

  useEffect(() => {
    const handleExternalUpdate = () => {
      setData(loadData());
    };
    window.addEventListener("calendar:updated", handleExternalUpdate);
    return () => window.removeEventListener("calendar:updated", handleExternalUpdate);
  }, []);

  const currentDay = normalizeDayRecord(data.days[selectedKey]);
  const sortedMoodLogs = useMemo(() => {
    return [...(currentDay.moodLogs || [])].sort((a, b) =>
      (b.time || "").localeCompare(a.time || "")
    );
  }, [currentDay.moodLogs]);

  const cycle = useMemo(() => calcCycle(data.periodDays), [data.periodDays]);

  const cells = useMemo(() => {
    const y = monthCursor.getFullYear();
    const m = monthCursor.getMonth();
    const first = new Date(y, m, 1);
    const padStart = (first.getDay() + 6) % 7;
    const gridStart = shiftDays(first, -padStart);
    const periodSet = new Set(data.periodDays);
    const todayKey = toDateKey(today);

    return Array.from({ length: 42 }, (_, i) => {
      const date = shiftDays(gridStart, i);
      const key = toDateKey(date);
      const isPeriod = periodSet.has(key);
      const isPredict = !isPeriod && cycle.predicted.has(key);
      const dayRec = normalizeDayRecord(data.days[key]);
      const dayLogsSorted = [...dayRec.moodLogs].sort((a, b) =>
        (b.time || "").localeCompare(a.time || "")
      );
      const latestLog = dayLogsSorted[0] || null;
      const latestMood = latestLog ? MOODS.find((item) => item.id === latestLog.moodId) : null;

      return {
        date,
        key,
        num: date.getDate(),
        outside: date.getMonth() !== m,
        isToday: key === todayKey,
        isPeriod,
        isPredict,
        latestMood,
        moodCount: dayLogsSorted.length,
        events: dayRec.events || [],
      };
    });
  }, [monthCursor, data.periodDays, data.days, cycle.predicted, today]);

  const handleSaveMood = () => {
    if (!moodDraft) return;
    const cleanTime = (timeDraft || "").trim() || getCurrentTimeHHMM();
    const cleanNote = noteDraft.trim();

    setData((prev) => {
      const old = normalizeDayRecord(prev.days[selectedKey]);
      let nextLogs;
      if (editingLogId) {
        nextLogs = old.moodLogs.map((item) =>
          item.id === editingLogId
            ? { ...item, moodId: moodDraft, time: cleanTime, note: cleanNote }
            : item
        );
      } else {
        const newEntry = {
          id: `mood_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          moodId: moodDraft,
          time: cleanTime,
          note: cleanNote,
        };
        nextLogs = [...old.moodLogs, newEntry];
      }
      return {
        ...prev,
        days: {
          ...prev.days,
          [selectedKey]: {
            ...old,
            moodLogs: nextLogs,
          },
        },
      };
    });

    resetMoodForm();
    notifyCalendarUpdated({ date: selectedKey, action: "mood" });
  };

  const handleStartEditLog = (log) => {
    setEditingLogId(log.id);
    setMoodDraft(log.moodId);
    setTimeDraft(log.time || getCurrentTimeHHMM());
    setNoteDraft(log.note || "");
  };

  const handleDeleteLog = (logId) => {
    setData((prev) => {
      const old = normalizeDayRecord(prev.days[selectedKey]);
      return {
        ...prev,
        days: {
          ...prev.days,
          [selectedKey]: {
            ...old,
            moodLogs: old.moodLogs.filter((item) => item.id !== logId),
          },
        },
      };
    });
    if (editingLogId === logId) {
      resetMoodForm();
    }
    notifyCalendarUpdated({ date: selectedKey, action: "mood" });
  };

  const addEvent = (e) => {
    e.preventDefault();
    const title = eventInput.trim();
    if (!title) return;
    setData((prev) => {
      const old = normalizeDayRecord(prev.days[selectedKey]);
      return {
        ...prev,
        days: {
          ...prev.days,
          [selectedKey]: {
            ...old,
            events: [
              ...(old.events || []),
              { title, tag: eventTag, source: "user", createdBy: "我" },
            ],
          },
        },
      };
    });
    setEventInput("");
    notifyCalendarUpdated({ date: selectedKey, action: "event" });
  };

  const removeEvent = (idx) => {
    setData((prev) => {
      const old = normalizeDayRecord(prev.days[selectedKey]);
      return {
        ...prev,
        days: {
          ...prev.days,
          [selectedKey]: {
            ...old,
            events: (old.events || []).filter((_, i) => i !== idx),
          },
        },
      };
    });
    notifyCalendarUpdated({ date: selectedKey, action: "event" });
  };

  const togglePeriod = () => {
    setData((prev) => {
      const exists = prev.periodDays.includes(selectedKey);
      return {
        ...prev,
        periodDays: exists
          ? prev.periodDays.filter((d) => d !== selectedKey)
          : [...prev.periodDays, selectedKey],
      };
    });
    notifyCalendarUpdated({ date: selectedKey, action: "period" });
  };

  const selectedDate = parseDateKey(selectedKey);
  const isPeriodDay = data.periodDays.includes(selectedKey);

  return (
    <div
      style={{
        padding: 12,
        width: "100%",
        maxWidth: 980,
        margin: "0 auto",
        boxSizing: "border-box",
        overflowX: "hidden",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {onBackHome && (
            <button type="button" onClick={onBackHome} style={{ flexShrink: 0 }}>
              返回
            </button>
          )}
          <h2 style={{ margin: 0, fontSize: 17, whiteSpace: "nowrap" }}>
            生活日历 ʚ˃ ᵕ ˂ɞ
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() =>
              setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))
            }
          >
            上月
          </button>
          <span style={{ fontWeight: 600, minWidth: 74, textAlign: "center", fontSize: 14 }}>
            {monthCursor.getFullYear()}.{pad2(monthCursor.getMonth() + 1)}
          </span>
          <button
            type="button"
            onClick={() =>
              setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))
            }
          >
            下月
          </button>
          <button
            type="button"
            onClick={() => {
              setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelectedKey(toDateKey(today));
            }}
          >
            今天
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <div
          style={{
            border: "1px solid #e6e2df",
            borderRadius: 12,
            padding: 8,
            background: "#fff",
            minWidth: 0,
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              textAlign: "center",
              fontSize: 12,
              color: "#777",
              marginBottom: 6,
            }}
          >
            {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
              <div key={w} style={{ minWidth: 0 }}>
                {w}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 3,
              minWidth: 0,
            }}
          >
            {cells.map((c) => {
              const active = c.key === selectedKey;
              return (
                <div
                  key={c.key}
                  onClick={() => {
                    setSelectedKey(c.key);
                    if (c.outside) {
                      setMonthCursor(new Date(c.date.getFullYear(), c.date.getMonth(), 1));
                    }
                  }}
                  style={{
                    minHeight: 68,
                    minWidth: 0,
                    overflow: "hidden",
                    padding: 3,
                    borderRadius: 8,
                    cursor: "pointer",
                    boxSizing: "border-box",
                    opacity: c.outside ? 0.5 : 1,
                    border: active
                      ? "2px solid #e57a8e"
                      : c.isPredict
                      ? "1px dashed #b999cb"
                      : "1px solid #efefef",
                    background: c.isPeriod ? "#fce8ee" : c.isPredict ? "#f5eef8" : "#fff",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 11,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: c.isToday ? 700 : 400,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.num}
                      {c.isToday ? "·今" : ""}
                    </span>
                    {c.isPeriod && (
                      <span style={{ color: "#c93b5b", fontSize: 10, flexShrink: 0 }}>经</span>
                    )}
                    {!c.isPeriod && c.isPredict && (
                      <span style={{ color: "#76548d", fontSize: 10, flexShrink: 0 }}>预</span>
                    )}
                  </div>

                  {c.latestMood && (
                    <div
                      style={{
                        fontSize: 10,
                        background: c.latestMood.bg,
                        color: c.latestMood.color,
                        borderRadius: 5,
                        padding: "1px 3px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {c.latestMood.kaomoji}
                      {c.moodCount > 1 ? ` ×${c.moodCount}` : ""}
                    </div>
                  )}

                  {c.events.length > 0 && (() => {
                    const evStyle = getEventColorStyle(c.events[0]);
                    return (
                      <div
                        style={{
                          fontSize: 10,
                          background: evStyle.bg,
                          color: evStyle.color,
                          border: evStyle.border,
                          borderRadius: 5,
                          padding: "1px 3px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }}
                      >
                        {c.events[0].title}
                        {c.events.length > 1 ? `(${c.events.length})` : ""}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e6e2df",
            borderRadius: 12,
            padding: 12,
            background: "#fff",
            minWidth: 0,
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日（周
            {"日一二三四五六"[selectedDate.getDay()]}）
          </div>

          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {editingLogId ? "修改心情记录" : "新增心情记录"}
              </span>
              <label
                style={{
                  fontSize: 12,
                  color: "#666",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                时间
                <input
                  type="time"
                  value={timeDraft}
                  onChange={(e) => setTimeDraft(e.target.value)}
                  style={{
                    padding: "2px 6px",
                    borderRadius: 6,
                    border: "1px solid #ddd",
                    fontSize: 12,
                    maxWidth: "100%",
                  }}
                />
              </label>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))",
                gap: 6,
              }}
            >
              {MOODS.map((m) => {
                const picked = moodDraft === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMoodDraft(m.id)}
                    style={{
                      textAlign: "left",
                      padding: 6,
                      borderRadius: 8,
                      border: picked ? "2px solid #e57a8e" : "1px solid #e2e2e2",
                      background: picked ? m.bg : "#fff",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.kaomoji}
                    </div>
                    <div style={{ fontSize: 11, color: "#666" }}>{m.label}</div>
                  </button>
                );
              })}
            </div>

            <textarea
              rows={2}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="写一点这一刻的想法或备注（可选）..."
              style={{
                width: "100%",
                boxSizing: "border-box",
                marginTop: 6,
                padding: 6,
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            />

            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={handleSaveMood}>
                {editingLogId ? "更新记录" : "添加心情"}
              </button>
              {editingLogId && (
                <button type="button" onClick={resetMoodForm}>
                  取消编辑
                </button>
              )}
            </div>

            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {sortedMoodLogs.length === 0 ? (
                <div style={{ fontSize: 12, color: "#888" }}>这一天还没有心情记录</div>
              ) : (
                sortedMoodLogs.map((log) => {
                  const m = MOODS.find((item) => item.id === log.moodId) || MOODS[0];
                  return (
                    <div
                      key={log.id}
                      style={{
                        background: m.bg,
                        color: m.color,
                        borderRadius: 8,
                        padding: "7px 9px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <div style={{ fontSize: 12, minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, wordBreak: "break-word" }}>
                          <span>{log.time}</span> · <span>{m.kaomoji}</span>{" "}
                          <span style={{ fontWeight: 400 }}>({m.label})</span>
                        </div>
                        {log.note && (
                          <div style={{ marginTop: 2, fontSize: 12, wordBreak: "break-word" }}>
                            {log.note}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button type="button" onClick={() => handleStartEditLog(log)}>
                          改
                        </button>
                        <button type="button" onClick={() => handleDeleteLog(log.id)}>
                          删
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ marginBottom: 14, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>重要事件</span>
              <span style={{ fontSize: 11, color: "#666" }}>
                <span style={{ color: "#b02a5b", fontWeight: 600 }}>■ 粉色：我</span>
                {" · "}
                <span style={{ color: "#1d5fa7", fontWeight: 600 }}>■ 蓝色：小克</span>
              </span>
            </div>

            <form
              onSubmit={addEvent}
              style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}
            >
              <select value={eventTag} onChange={(e) => setEventTag(e.target.value)}>
                <option value="重要">重要</option>
                <option value="工作">工作</option>
                <option value="生活">生活</option>
                <option value="纪念">纪念</option>
              </select>
              <input
                type="text"
                value={eventInput}
                onChange={(e) => setEventInput(e.target.value)}
                placeholder="事件标题..."
                style={{
                  flex: "1 1 120px",
                  minWidth: 0,
                  padding: "5px 8px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                }}
              />
              <button type="submit">添加</button>
            </form>

            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {(currentDay.events || []).map((ev, idx) => {
                const evStyle = getEventColorStyle(ev);
                return (
                  <div
                    key={`${ev.title}-${idx}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      background: evStyle.bg,
                      color: evStyle.color,
                      border: evStyle.border,
                      padding: "5px 8px",
                      borderRadius: 8,
                      fontSize: 12,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ wordBreak: "break-word", minWidth: 0 }}>
                      [{evStyle.badge}·{ev.tag}] {ev.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeEvent(idx)}
                      style={{ flexShrink: 0 }}
                    >
                      删
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>生理期</div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 12 }}>
                {isPeriodDay ? "当天已标为生理期" : "当天未标记生理期"}
              </span>
              <button type="button" onClick={togglePeriod}>
                {isPeriodDay ? "取消标记" : "标为经期"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>
              {cycle.lastStart
                ? `最近起点 ${cycle.lastStart} · 估算周期 ${cycle.cycleLen} 天 / 经期 ${cycle.periodLen} 天（仅供参考）`
                : "标记经期日期后自动推算下次预测日。"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
