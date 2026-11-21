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
  const safeList = Array.isArray(messages) ? messages : [];
  const content = safeList
    .map((msg) => {
      const roleLabel = msg?.role === 'user' ? '我' : '本体';
      return `[${roleLabel}]\n${msg?.content ?? ''}\n`;
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

export function writeBackupSnapshot(backupKey, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  writeStorageJSON(backupKey, {
    savedAt: new Date().toISOString(),
    count: messages.length,
    messages,
  });
}

export function readBackupSnapshot(backupKey) {
  const data = readStorageJSON(backupKey, null);
  if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
    return null;
  }
  return data;
}

export function exportBackupSnapshotAsTxt(
  backupKey,
  filename = 'claude-backup-snapshot.txt'
) {
  const snapshot = readBackupSnapshot(backupKey);
  if (!snapshot || !Array.isArray(snapshot.messages) || snapshot.messages.length === 0) {
    return false;
  }
  exportMessagesAsTxt(snapshot.messages, filename);
  return true;
}

export function formatBackupFilename(prefix = 'claude-auto-backup') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${stamp}.txt`;
}
