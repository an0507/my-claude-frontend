import { useState } from 'react';
import ChatApp from './components/ChatApp';
import DiaryApp from './components/DiaryApp';
import PhoneHome from './components/PhoneHome';

export default function App() {
  const [activeApp, setActiveApp] = useState('home');

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
        alignItems: 'center',
        padding: '20px 12px 28px',
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
            padding: '10px 16px 12px',
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
