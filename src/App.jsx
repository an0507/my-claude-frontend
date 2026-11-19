import { useEffect, useState } from 'react';
import ChatApp from './components/ChatApp';
import DiaryApp from './components/DiaryApp';
import PhoneHome from './components/PhoneHome';

function getStatusTime() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function App() {
  const [activeApp, setActiveApp] = useState('home');
  const [statusTime, setStatusTime] = useState(getStatusTime);

  useEffect(() => {
    const timer = setInterval(() => {
      setStatusTime(getStatusTime());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const headerTitle =
    activeApp === 'home'
      ? '小手机主页'
      : activeApp === 'diary'
      ? '克劳德日记'
      : '私聊';

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(180deg, #fff5f8 0%, #fde4ec 100%)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        color: '#2d1e24',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '16px 12px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#fff9fb',
          borderRadius: 28,
          boxShadow: '0 14px 36px rgba(219, 112, 147, 0.2)',
          border: '2px solid #f5c6d6',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 手机顶部状态栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 600,
            color: '#6e4d59',
            background: '#fff4f8',
            borderBottom: '1px solid #fce4ec',
          }}
        >
          <span>{statusTime}</span>
          <span>{headerTitle}</span>
          <span>5G · 100%</span>
        </div>

        {/* 当前打开的页面 */}
        {activeApp === 'home' ? (
          <PhoneHome onOpenApp={(appId) => setActiveApp(appId)} />
        ) : activeApp === 'diary' ? (
          <DiaryApp onBackHome={() => setActiveApp('home')} />
        ) : (
          <ChatApp onBackHome={() => setActiveApp('home')} />
        )}

        {/* 底部 Home 导航条 */}
        <div
          style={{
            padding: '8px 16px 10px',
            background: '#fff9fb',
            borderTop: '1px solid #fce4ec',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveApp('home')}
            title="回到手机主页"
            style={{
              width: 112,
              height: 5,
              borderRadius: 999,
              border: 'none',
              background: activeApp === 'home' ? '#f0cedb' : '#e57399',
              cursor: 'pointer',
            }}
          />
        </div>
      </div>
    </div>
  );
}
