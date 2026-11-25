export const BACKEND_URL = 'https://my-claude-backend.onrender.com';

export const MODEL_OPTIONS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6（稳）' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5（超高缓存）' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5（Max特惠）' },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';

export const RESPONSE_LENGTH_OPTIONS = [
  { id: 'concise', label: '简短', maxTokens: 400 },
  { id: 'normal', label: '适中', maxTokens: 1000 },
  { id: 'detailed', label: '详细', maxTokens: 2048 },
];

export const DEFAULT_RESPONSE_LENGTH = 'normal';

export const STORAGE_KEYS = {
  MESSAGES: 'claude_messages_v1',
  MESSAGES_BACKUP: 'claude_messages_backup_v1',
  CONVERSATIONS: 'claude_conversations_v1',
  ACTIVE_CONVERSATION_ID: 'claude_active_conversation_v1',
  SELECTED_MODEL: 'claude_selected_model_v1',
  RESPONSE_LENGTH: 'claude_response_length_v1',
  DELETED_MEMORIES: 'claude_deleted_memories_v1',
};

export const AUTO_BACKUP_CONFIG = {
  ENABLED: true,
  EVERY_N_MESSAGES: 40,
  INTERVAL_MS: 5 * 60 * 1000,
  MAX_SNAPSHOTS: 20,
  STORAGE_KEY: 'claude_auto_backups_v1',
};
