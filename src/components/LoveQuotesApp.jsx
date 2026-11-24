import { useEffect, useState } from 'react';
import { BACKEND_URL } from '../constants/chatConfig';

function getTodayMonthDay() {
  const d = new Date();
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function LoveQuotesApp({ onBackHome }) {
  const [section, setSection] = useState('安安');
  const [quoteDate, setQuoteDate] = useState(() => getTodayMonthDay());
  const [quoteInput, setQuoteInput] = useState('');
  const [quotesContent, setQuotesContent] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  async function loadQuotes() {
    setLoadingList(true);
    setStatusMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`);
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || '读取心动语录失败');
      }
      setQuotesContent(typeof data?.content === 'string' ? data.content : '');
    } catch (err) {
      setStatusMsg(err?.message || '读取失败，请稍后重试');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadQuotes();
  }, []);

  async function handleAppendQuote() {
    const clean = quoteInput.trim();
    if (!clean || saving) return;

    setSaving(true);
    setStatusMsg('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/love-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section,
          date: quoteDate.trim() || getTodayMonthDay(),
          quote: clean,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || '保存失败');
      }
      setQuoteInput('');
      if (typeof data?.content === 'string') {
        setQuotesContent(data.content);
      }
      setStatusMsg(
        `已写入「${section}心动语录 · ${
          quoteDate.trim() || getTodayMonthDay()
        }」，下次聊天自动生效`
      );
    } catch (err) {
      setStatusMsg(err?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'linear-gradient(180deg, #fff7fa 0%, #fce8ef 100%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 14px',
          borderBottom: '1px solid #fce4ec',
          background: '#fff9fb',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={onBackHome}
            disabled={saving}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid #f0cedb',
              background: '#ffffff',
              color: '#be185d',
              cursor: saving ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            ← 桌面
          </button>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: '#3b232c',
            }}
          >
            心动语录
          </h2>
        </div>

        <button
          type="button"
          onClick={loadQuotes}
          disabled={loadingList || saving}
          style={{
            padding: '5px 10px',
            fontSize: 12,
            borderRadius: 999,
            border: '1px solid #f0cedb',
            background: '#ffffff',
            color: '#6e4d59',
            cursor: loadingList || saving ? 'not-allowed' : 'pointer',
          }}
        >
          {loadingList ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div
        style={{
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {['安安', '顾青'].map((tab) => {
            const active = section === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setSection(tab)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: '1px solid #f0cedb',
                  background: active ? '#ffe4ee' : '#ffffff',
                  color: active ? '#be185d' : '#6e4d59',
                  cursor: 'pointer',
                }}
              >
                {tab}心动语录
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6e4d59', whiteSpace: 'nowrap' }}>
            日期分组：
          </span>
          <input
            type="text"
            value={quoteDate}
            onChange={(e) => setQuoteDate(e.target.value)}
            placeholder="如 11.24"
            style={{
              width: 96,
              padding: '7px 10px',
              fontSize: 13,
              borderRadius: 10,
              border: '1px solid #f2cedb',
              background: '#ffffff',
              color: '#2d1e24',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: '#9a7b86' }}>
            已有同日期自动接在末尾，没有则新建日期
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={quoteInput}
            onChange={(e) => setQuoteInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAppendQuote()}
            placeholder={`写一条${section}心动语录…`}
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: 14,
              borderRadius: 12,
              border: '1px solid #f2cedb',
              background: '#ffffff',
              color: '#2d1e24',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleAppendQuote}
            disabled={saving || !quoteInput.trim()}
            style={{
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 12,
              border: 'none',
              background:
                saving || !quoteInput.trim() ? '#f5c6d6' : '#e57399',
              color: '#ffffff',
              cursor:
                saving || !quoteInput.trim() ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {saving ? '保存中' : '追加'}
          </button>
        </div>

        {statusMsg && (
          <div style={{ fontSize: 12, color: '#be185d' }}>{statusMsg}</div>
        )}

        <div
          style={{
            marginTop: 2,
            padding: 12,
            borderRadius: 14,
            background: 'rgba(255, 255, 255, 0.92)',
            border: '1px solid #f5d6e2',
            maxHeight: '44dvh',
            overflowY: 'auto',
            fontSize: 13,
            lineHeight: 1.65,
            color: '#3b232c',
            whiteSpace: 'pre-wrap',
          }}
        >
          {loadingList
            ? '正在加载心动语录…'
            : quotesContent || '（还没有心动语录，在上方输入第一条吧）'}
        </div>
      </div>
    </div>
  );
}
