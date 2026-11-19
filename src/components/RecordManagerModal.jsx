import { useState } from 'react';

export default function RecordManagerModal({
  open,
  disabled,
  messageCount,
  onClose,
  onConfirmClear,
}) {
  const [confirming, setConfirming] = useState(false);

  if (!open) return null;

  const handleClose = () => {
    setConfirming(false);
    onClose();
  };

  const handleClear = () => {
    setConfirming(false);
    onConfirmClear();
  };

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(45, 30, 36, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#fff9fb',
          border: '1px solid #f0cedb',
          borderRadius: 18,
          padding: 18,
          boxShadow: '0 14px 32px rgba(190, 24, 93, 0.16)',
          color: '#2d1e24',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            记录管理
          </h3>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              borderRadius: 999,
              border: '1px solid #f0cedb',
              background: '#ffffff',
              color: '#6e4d59',
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.6, color: '#6e4d59' }}>
          为防止误触，清空记录已移出聊天页。当前共有 {messageCount} 条消息，清空前会自动保留本地备份快照。
        </p>

        {!confirming ? (
          <button
            type="button"
            disabled={disabled || messageCount === 0}
            onClick={() => setConfirming(true)}
            style={{
              width: '100%',
              padding: '9px 14px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 12,
              border: '1px solid #f3d5e0',
              background: disabled || messageCount === 0 ? '#fdf2f6' : '#fff0f5',
              color: disabled || messageCount === 0 ? '#c4a4b0' : '#be185d',
              cursor: disabled || messageCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            清空聊天记录
          </button>
        ) : (
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: '#fff0f5',
              border: '1px solid #f3d5e0',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9d174d', marginBottom: 10 }}>
              确定要清空当前聊天记录吗？
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: 'none',
                  background: '#be185d',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                确认清空
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  borderRadius: 10,
                  border: '1px solid #f0cedb',
                  background: '#ffffff',
                  color: '#6e4d59',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
