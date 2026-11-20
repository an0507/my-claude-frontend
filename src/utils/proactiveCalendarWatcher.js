import {
  CALENDAR_SYSTEM_RULE,
  extractCalendarEventAdd,
  extractCalendarQuery,
  isPassResponse,
  runCalendarEventAdd,
  runCalendarQuery,
  stripCalendarControlTokens,
} from "./calendarBridge";

export function attachProactiveCalendarWatcher({
  getMessages,
  getBaseSystemPrompt,
  streamChatOnce,
  onProactiveMessage,
}) {
  let debounceTimer = null;
  let running = false;

  const handleUpdated = (event) => {
    const detail = event.detail || {};
    if (detail.source === "claude") return;

    const date = detail.date || "";
    const actionLabel =
      detail.action === "mood"
        ? "心情记录"
        : detail.action === "event"
        ? "重要事件"
        : detail.action === "period"
        ? "生理期标记"
        : "日历内容";

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      if (running) return;
      running = true;

      try {
        const systemPrompt = `${getBaseSystemPrompt() || ""}\n\n${CALENDAR_SYSTEM_RULE}`.trim();
        const history = Array.isArray(getMessages()) ? getMessages().slice(-12) : [];

        const triggerMsg = {
          role: "user",
          content:
            `[系统提示：对方刚刚在生活日历的 ${date || "某天"} 更新了「${actionLabel}」。` +
            `你可以自己决定要不要去看日历、要不要记事件、要不要主动跟对方说句话。` +
            `如果决定不看或不说话，请只回复 [PASS]；如果想看某天/某项内容，请输出 [[查日历: YYYY-MM-DD, scope]]；如果想记事件，请输出 [[记日历事件: YYYY-MM-DD, 标签, 标题]]。]`,
        };

        let firstReply = "";
        await streamChatOnce([...history, triggerMsg], systemPrompt, (chunk) => {
          firstReply += chunk;
        });

        if (!firstReply || isPassResponse(firstReply)) {
          return;
        }

        const eventAdd = extractCalendarEventAdd(firstReply);
        const query = extractCalendarQuery(firstReply);

        let contextNote = "";
        if (eventAdd) {
          const addRes = runCalendarEventAdd(eventAdd);
          contextNote += `${addRes}\n`;
        }
        if (query) {
          contextNote += `${runCalendarQuery(query.dateSpec, query.scopes)}\n`;
        }

        if (!contextNote) {
          const clean = stripCalendarControlTokens(firstReply);
          if (clean && !isPassResponse(clean)) {
            onProactiveMessage(clean);
          }
          return;
        }

        const followUpMessages = [
          ...history,
          triggerMsg,
          { role: "assistant", content: firstReply },
          {
            role: "user",
            content: `${contextNote.trim()}\n\n（以上是你刚完成的日历操作/查阅结果。如果觉得值得主动跟对方聊一句，请自然地说出来；如果看完觉得没必要打扰，请只回复 [PASS]。）`,
          },
        ];

        let secondReply = "";
        await streamChatOnce(followUpMessages, systemPrompt, (chunk) => {
          secondReply += chunk;
        });

        const finalText = stripCalendarControlTokens(
          secondReply || eventAdd?.cleanText || query?.cleanText || ""
        );
        if (finalText && !isPassResponse(finalText)) {
          onProactiveMessage(finalText);
        }
      } catch (err) {
        console.error("日历主动查阅/记事件出错:", err);
      } finally {
        running = false;
      }
    }, 1500);
  };

  window.addEventListener("calendar:updated", handleUpdated);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    window.removeEventListener("calendar:updated", handleUpdated);
  };
}
