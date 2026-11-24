import {
  CalendarLineIcon,
  ChatLineIcon,
  DiaryLineIcon,
} from './LineIcons';

const DESKTOP_APPS = [
  {
    id: 'chat',
    label: '私聊',
    badge: '顾青',
    Icon: ChatLineIcon,
  },
  {
    id: 'diary',
    label: '克劳德日记',
    badge: '04:00',
    Icon: DiaryLineIcon,
  },
  {
    id: 'calendar',
    label: '生活日历',
    badge: '心情·日程',
    Icon: CalendarLineIcon,
  },
];

export default function PhoneHome({ activeApp, onSelectApp }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '22px 18px 20px',
        background: 'linear-gradient(180deg, #fff6f9 0%, #fce6ee 100%)',
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 18,
            padding: '0 4px',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3b232c' }}>
              小手机桌面
            </div>
            <div style={{ fontSize: 12, color: '#8c6a76', marginTop: 2 }}>
              点图标进入对应应用
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#be185d',
              background: '#fff0f5',
              border: '1px solid #f2cedb',
              borderRadius: 999,
              padding: '4px 10px',
              fontWeight: 600,
            }}
          >
            当前: {activeApp || 'home'}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 14,
          }}
        >
          {DESKTOP_APPS.map(({ id, label, badge, Icon }) => {
            const isSelected = activeApp === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectApp(id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '18px 12px',
                  borderRadius: 20,
                  border: isSelected ? '2px solid #e57399' : '1px solid #f3d2de',
                  background: 'rgba(255, 255, 255, 0.92)',
                  boxShadow: '0 8px 20px rgba(219, 112, 147, 0.1)',
                  cursor: 'pointer',
                  color: '#3b232c',
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 15,
                    background: '#fff0f5',
                    border: '1px solid #f5d6e2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={24} color="#be185d" />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 11, color: '#9a7b86' }}>{badge}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          textAlign: 'center',
          fontSize: 11.5,
          color: '#9a7b86',
          paddingTop: 12,
        }}
      >
        my-claude-frontend
      </div>
    </div>
  );
}
