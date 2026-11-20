import {
  CALENDAR_SYSTEM_RULE,
  extractCalendarQuery,
  isPassResponse,
  runCalendarQuery,
} from "./calendarBridge";

/**
 * 挂载日历变动监听：用户记完心情/事件/经期后，由 AI 自己决定要不要看并主动说话
 * @param {Object} params
 * @param {Function} params.getMessages - 获取当前聊天消息数组 () => messages
 * @param {Function} params.getBaseSystemPrompt - 获取原有系统提示词 () => string
 * @param {Function} params.streamChatOnce - 单次流式请求 (msgs, sys, onChunk) => Promise<string>
 * @param {Function} params.onProactiveMessage - 当 AI 决定主动开口时回调 (finalText) => void
 */
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
            `你可以自己决定要不要去看日历、要不要主动跟对方说句话。` +
            `如果决定不看或不说话，请只回复 [PASS]；如果想看某天/某项内容，请输出 [[查日历: YYYY-MM-DD, scope]]。]`,
        };

        let firstReply = "";
        await streamChatOnce([...history, triggerMsg], systemPrompt, (chunk) => {
          firstReply += chunk;
        });

        if (!firstReply || isPassResponse(firstReply)) {
          return;
        }

        const query = extractCalendarQuery(firstReply);
        if (!query) {
          const clean = firstReply.trim();
          if (clean && !isPassResponse(clean)) {
            onProactiveMessage(clean);
          }
          return;
        }

        // 小克决定查日历：读取对应数据后再生成主动回复
        const lookupResult = runCalendarQuery(query.dateSpec, query.scopes);
        const followUpMessages = [
          ...history,
          triggerMsg,
          { role: "assistant", content: firstReply },
          {
            role: "user",
            content: `${lookupResult}\n\n（以上是你刚翻看日历查到的内容。如果觉得值得主动跟对方聊一句，请自然地说出来；如果看完觉得没必要打扰，请只回复 [PASS]。）`,
          },
        ];

        let secondReply = "";
        await streamChatOnce(followUpMessages, systemPrompt, (chunk) => {
          secondReply += chunk;
        });

        const finalText = (secondReply || query.cleanText || "").trim();
        if (finalText && !isPassResponse(finalText)) {
          onProactiveMessage(finalText);
        }
      } catch (err) {
        console.error("日历主动查阅流程出错:", err);
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
