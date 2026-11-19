export const BACKEND_URL = 'https://my-claude-backend.onrender.com';

export const MODEL_OPTIONS = [
  { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { id: 'claude-opus-4-6', label: 'claude-opus-4-6' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-fable-5-0', label: 'Claude Fable 5.0' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
];

export const DEFAULT_MODEL = MODEL_OPTIONS[0].id;

export const RESPONSE_LENGTH_OPTIONS = [
  { id: 'short', label: '简短', maxTokens: 512 },
  { id: 'medium', label: '适中', maxTokens: 1500 },
  { id: 'long', label: '详细', maxTokens: 4000 },
];

export const DEFAULT_RESPONSE_LENGTH = 'medium';

export const STORAGE_KEYS = {
  MESSAGES: 'claude_chat_messages_v1',
  MESSAGES_BACKUP: 'claude_chat_messages_backup_v1',
  SELECTED_MODEL: 'claude_selected_model_v1',
  RESPONSE_LENGTH: 'claude_response_length_v1',
};

// 20 轮对话 = 40 条消息（用户 + 助手各算 1 条）；若你想每 20 条消息备份一次，改成 20 即可
export const AUTO_BACKUP_CONFIG = {
  ENABLED: true,
  EVERY_N_MESSAGES: 40,
};
