export const BACKEND_URL = 'https://my-claude-backend.onrender.com';

export const STORAGE_KEYS = {
  MESSAGES: 'my_claude_chat_messages_v1',
  MESSAGES_BACKUP: 'my_claude_chat_messages_backup_v1',
  SELECTED_MODEL: 'my_claude_selected_model_v1',
  RESPONSE_LENGTH: 'my_claude_response_length_v1',
};

export const DEFAULT_MODEL = 'f5.2';

export const MODEL_OPTIONS = [
  { id: 'f5.2', label: 'f5.2' },
  { id: 'o5.5', label: 'o5.5' },
  { id: 'f5.1', label: 'f5.1' },
  { id: 'f5', label: 'f5' },
  { id: 'o5', label: 'o5' },
  { id: 'o4.6', label: 'o4.6' },
];

export const RESPONSE_LENGTH_OPTIONS = [
  { id: 'short', label: '简短', maxTokens: 300 },
  { id: 'normal', label: '正常', maxTokens: 1024 },
  { id: 'detailed', label: '展开', maxTokens: 2500 },
];

export const DEFAULT_RESPONSE_LENGTH = 'normal';

export const AUTO_BACKUP_CONFIG = {
  ENABLED: true,
  EVERY_N_MESSAGES: 10,
};
