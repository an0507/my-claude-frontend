export function readStorageJSON(key, fallbackValue) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallbackValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] 读取 ${key} 失败，使用默认值:`, err);
    return fallbackValue;
  }
}

export function writeStorageJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[storage] 写入 ${key} 失败:`, err);
  }
}

export function exportMessagesAsTxt(messages, filename = 'chat-history.txt') {
  const content = messages
    .map((msg) => {
      const roleLabel = msg.role === 'user' ? '我' : '本体';
      return `[${roleLabel}]\n${msg.content}\n`;
    })
    .join('\n---\n\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
