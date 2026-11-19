import { useEffect, useState } from 'react';

function formatNow() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const week = weekNames[now.getDay()];
  return {
    time: `${hh}:${mm}`,
    dateText: `${month}月${day}日 ${week}`,
  };
}

export default function PhoneHome({ onOpenApp }) {
  const [clock, setClock] = useState(formatNow);

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(formatNow());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const apps = [
    {
      id: 'chat',
      name: '私聊',
      icon: '💬',
      bg: 'linear-gradient(135deg, #ff85b3 0%, #e55381 100%)',
      badge: '在线',
      ready: true,
    },
    {
      id: 'notes',
      name: '随手记',
      icon: '📝',
      bg: 'linear-gradient(135deg, #ffd166 0%, #f4a261 100%)',
      badge: '待加',
      ready: false,
    },
  ];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 460,
        padding: '22px 18px 24px',
        background:
          'radial-gradient(circle at top, #fff0f6 0%, #fce0ea 58%, #f8cfe0 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div>
        {/* 桌面时钟小组件 */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.72)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #f7d2e2',
            borderRadius: 20,
            padding: '16px 18px',
            marginBottom: 22,
            boxShadow: '0 6px 18px rgba(219, 112, 147, 0.1)',
          }}
        >
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 1,
              color: '#3b232c',
              lineHeight: 1.1,
            }}
          >
            {clock.time}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: '#7d5966',
            }}
          >
            {clock.dateText} · 小手机桌面
          </div>
        </div>

        {/* 应用图标网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 16,
          }}
        >
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => {
                if (app.ready) {
                  onOpenApp(app.id);
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 7,
                cursor: app.ready ? 'pointer' : 'default',
                opacity: app.ready ? 1 : 0.78,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: 58,
                  height: 58,
                  borderRadius: 18,
                  background: app.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  boxShadow: '0 8px 18px rgba(190, 24, 93, 0.16)',
                  border: '2px solid rgba(255, 255, 255, 0.85)',
                }}
              >
                <span>{app.icon}</span>
                <span
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -6,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 5px',
                    borderRadius: 999,
                    background: app.ready ? '#be185d' : '#9a7b86',
                    color: '#ffffff',
                  }}
                >
                  {app.badge}
                </span>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#3b232c',
                }}
              >
                {app.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 底部提示 */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: '#8c6a76',
          paddingTop: 18,
        }}
      >
        点击「私聊」进入对话，后续可继续添加更多小软件
      </div>
    </div>
  );
}
