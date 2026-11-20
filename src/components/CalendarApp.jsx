import { useEffect, useMemo, useState } from "react";

const MOODS = [
  { id: "happy", kaomoji: "ʚ˃ ᵕ ˂ɞ", label: "开心/幸福", bg: "#fff3e6", color: "#9a5b13" },
  { id: "cozy", kaomoji: "ᯠ_   ̫ _ᯄ", label: "舒服/放松", bg: "#e8f6f0", color: "#236b52" },
  { id: "sad", kaomoji: "˃ ˄ ˂̥̥", label: "伤心/委屈", bg: "#edf2fb", color: "#3b5998" },
  { id: "down", kaomoji: "ᗜ ‸ ᗜ", label: "不开心/闷闷的", bg: "#f2eff5", color: "#5e546b" },
  { id: "shy", kaomoji: "^>⸝⸝⸝⸝<^", label: "害羞/心动", bg: "#fdecef", color: "#a83e5b" },
];

const STORAGE_KEY = "my_claude_calendar_v1";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
        (acc, ep) => acc + Math.max(1, dayDiff(parseDateKey(ep[0]), parseDateKey(ep[ep.length - 1])) + 1),
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

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        days: parsed.days || {},
        periodDays: Array.isArray(parsed.periodDays) ? parsed.periodDays : [],
      };
    }
  } catch (e) {
    console.error(e);
  }
  return { days: {}, periodDays: [] };
}

export default function CalendarApp({ onBack }) {
  const today = useMemo(() => new Date(), []);
  const [data, setData] = useState(loadData);
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedKey, setSelectedKey] = useState(() => toDateKey(today));

  const currentDay = data.days[selectedKey] || { mood: null, note: "", events: [] };
  const [moodDraft, setMoodDraft] = useState(currentDay.mood);
  const [noteDraft, setNoteDraft] = useState(currentDay.note);
  const [eventInput, setEventInput] = useState("");
  const [eventTag, setEventTag] = useState("重要");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    const info = data.days[selectedKey] || { mood: null, note: "", events: [] };
    setMoodDraft(info.mood || null);
    setNoteDraft(info.note || "");
  }, [selectedKey, data.days]);

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
      const dayRec = data.days[key] || { mood: null, note: "", events: [] };
      const moodObj = dayRec.mood ? MOODS.find((item) => item.id === dayRec.mood) : null;

      return {
        date,
        key,
        num: date.getDate(),
        outside: date.getMonth() !== m,
        isToday: key === todayKey,
        isPeriod,
        isPredict,
        moodObj,
        events: dayRec.events || [],
      };
    });
  }, [monthCursor, data.periodDays, data.days, cycle.predicted, today]);

  const saveMood = () => {
    setData((prev) => {
      const old = prev.days[selectedKey] || { mood: null, note: "", events: [] };
      return {
        ...prev,
        days: {
          ...prev.days,
          [selectedKey]: { ...old, mood: moodDraft, note: noteDraft.trim() },
        },
      };
    });
  };

  const addEvent = (e) => {
    e.preventDefault();
    const title = eventInput.trim();
    if (!title) return;
    setData((prev) => {
      const old = prev.days[selectedKey] || { mood: null, note: "", events: [] };
      return {
        ...prev,
        days: {
          ...prev.days,
          [selectedKey]: {
            ...old,
            events: [...(old.events || []), { title, tag: eventTag }],
          },
        },
      };
    });
    setEventInput("");
  };

  const removeEvent = (idx) => {
    setData((prev) => {
      const old = prev.days[selectedKey] || { mood: null, note: "", events: [] };
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
  };

  const selectedDate = parseDateKey(selectedKey);
  const isPeriodDay = data.periodDays.includes(selectedKey);

  return (
    <div style={{ padding: 14, maxWidth: 980, margin: "0 auto", fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onBack && (
            <button type="button" onClick={onBack}>
              返回
            </button>
          )}
          <h2 style={{ margin: 0, fontSize: 18 }}>生活日历 ʚ˃ ᵕ ˂ɞ</h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}>
            上月
          </button>
          <span style={{ fontWeight: 600, minWidth: 96, textAlign: "center" }}>
            {monthCursor.getFullYear()}.{pad2(monthCursor.getMonth() + 1)}
          </span>
          <button type="button" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        {/* 日历网格 */}
        <div style={{ border: "1px solid #e6e2df", borderRadius: 12, padding: 10, background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: 12, color: "#777", marginBottom: 6 }}>
            {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
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
                    minHeight: 74,
                    padding: 4,
                    borderRadius: 8,
                    cursor: "pointer",
                    opacity: c.outside ? 0.5 : 1,
                    border: active ? "2px solid #e57a8e" : c.isPredict ? "1px dashed #b999cb" : "1px solid #efefef",
                    background: c.isPeriod ? "#fce8ee" : c.isPredict ? "#f5eef8" : "#fff",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ fontWeight: c.isToday ? 700 : 400 }}>
                      {c.num}
                      {c.isToday ? "·今" : ""}
                    </span>
                    {c.isPeriod && <span style={{ color: "#c93b5b", fontSize: 10 }}>经</span>}
                    {!c.isPeriod && c.isPredict && <span style={{ color: "#76548d", fontSize: 10 }}>预</span>}
                  </div>

                  {c.moodObj && (
                    <div
                      style={{
                        fontSize: 11,
                        background: c.moodObj.bg,
                        color: c.moodObj.color,
                        borderRadius: 5,
                        padding: "1px 3px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.moodObj.kaomoji}
                    </div>
                  )}

                  {c.events.length > 0 && (
                    <div
                      style={{
                        fontSize: 10,
                        background: "#eaf2fa",
                        color: "#2b547e",
                        borderRadius: 5,
                        padding: "1px 3px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.events[0].title}
                      {c.events.length > 1 ? `(${c.events.length})` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 当日详情 */}
        <div style={{ border: "1px solid #e6e2df", borderRadius: 12, padding: 12, background: "#fff" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日（周{"日一二三四五六"[selectedDate.getDay()]}）
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>心情颜文字</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {MOODS.map((m) => {
                const picked = moodDraft === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMoodDraft(picked ? null : m.id)}
                    style={{
                      textAlign: "left",
                      padding: 6,
                      borderRadius: 8,
                      border: picked ? "2px solid #e57a8e" : "1px solid #e2e2e2",
                      background: picked ? m.bg : "#fff",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{m.kaomoji}</div>
                    <div style={{ fontSize: 11, color: "#666" }}>{m.label}</div>
                  </button>
                );
              })}
            </div>
            <textarea
              rows={2}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="当天备注..."
              style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 6, borderRadius: 8, border: "1px solid #ddd" }}
            />
            <button type="button" onClick={saveMood} style={{ marginTop: 6 }}>
              保存心情
            </button>
          </div>

          <div style={{ marginBottom: 14, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>重要事件</div>
            <form onSubmit={addEvent} style={{ display: "flex", gap: 6 }}>
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
                style={{ flex: 1, padding: "5px 8px", borderRadius: 8, border: "1px solid #ddd" }}
              />
              <button type="submit">添加</button>
            </form>

            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {(currentDay.events || []).map((ev, idx) => (
                <div
                  key={`${ev.title}-${idx}`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f7f6f4", padding: "5px 8px", borderRadius: 8, fontSize: 12 }}
                >
                  <span>[{ev.tag}] {ev.title}</span>
                  <button type="button" onClick={() => removeEvent(idx)}>删</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>生理期</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12 }}>{isPeriodDay ? "当天已标为生理期" : "当天未标记生理期"}</span>
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
