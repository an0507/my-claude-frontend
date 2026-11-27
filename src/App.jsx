import { useState } from 'react';
import CalendarApp from './components/CalendarApp';
import ChatApp from './components/ChatApp';
import DiaryApp from './components/DiaryApp';
import PhoneHome from './components/PhoneHome';
import { useAutoDiaryScheduler } from './hooks/useAutoDiaryScheduler';

export default function App() {
  const [activeApp, setActiveApp] = useState('home');

  useAutoDiaryScheduler();

  const handleOpenApp = (nextApp) => {
    setActiveApp(nextApp);
  };

  const handleBackHome = () => {
    setActiveApp('home');
  };

  let content = null;
  if (activeApp === 'home') {
    content = <PhoneHome activeApp={activeApp} onOpenApp={handleOpenApp} />;
  } else if (activeApp === 'diary') {
    content = <DiaryApp onBackHome={handleBackHome} />;
  } else if (activeApp === 'calendar') {
    content = <CalendarApp onBackHome={handleBackHome} />;
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
      {content}
    </div>
  );
}
