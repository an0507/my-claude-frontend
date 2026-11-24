import { useEffect, useState } from 'react';
import CalendarApp from './components/CalendarApp';
import ChatApp from './components/ChatApp';
import DiaryApp from './components/DiaryApp';
import LoveQuotesApp from './components/LoveQuotesApp';
import PhoneHome from './components/PhoneHome';

export default function App() {
  const [activeApp, setActiveApp] = useState('home');

  useEffect(() => {
    console.log('[quotes-debug] App activeApp 变为:', activeApp);
  }, [activeApp]);

  const handleSelectApp = (nextApp) => {
    console.log('[quotes-debug] handleSelectApp 收到:', nextApp);
    setActiveApp(nextApp);
  };

  const handleBackHome = () => {
    console.log('[quotes-debug] 返回桌面');
    setActiveApp('home');
  };

  let content = null;
  if (activeApp === 'home') {
    content = <PhoneHome activeApp={activeApp} onSelectApp={handleSelectApp} />;
  } else if (activeApp === 'diary') {
    content = <DiaryApp onBackHome={handleBackHome} />;
  } else if (activeApp === 'calendar') {
    content = <CalendarApp onBackHome={handleBackHome} />;
  } else if (activeApp === 'quotes') {
    content = <LoveQuotesApp onBackHome={handleBackHome} />;
  } else {
    content = <ChatApp onBackHome={handleBackHome} />;
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff7fa',
      }}
    >
      <div
        style={{
          fontSize: 11,
          padding: '3px 10px',
          background: '#ffe4ee',
          color: '#9d174d',
          borderBottom: '1px solid #f5c6d6',
        }}
      >
        调试状态 activeApp = {String(activeApp)}
      </div>
      {content}
    </div>
  );
}
