// Grime to Prime — Quote Bot widget
// Self-contained: injects its own styles + DOM, talks to /api/chat.
// Loaded via <script src="/widget.js" defer> from index.html and booking.html.

(function () {
  if (window.__grimeBotLoaded) return;

  // ── Feature flag ──────────────────────────────────────────────────────────
  // Widget stays hidden on production until you explicitly enable it:
  //   • Visit any page with ?quotebot=1   → enables + remembers via localStorage
  //   • Visit any page with ?quotebot=0   → disables + clears the remembered flag
  //   • On localhost, widget is always on (no flag needed) for dev.
  try {
    const params = new URLSearchParams(window.location.search);
    const isLocalhost = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    if (params.get('quotebot') === '1') {
      localStorage.setItem('grime-quotebot', '1');
    } else if (params.get('quotebot') === '0') {
      localStorage.removeItem('grime-quotebot');
      return;
    }
    const enabled = isLocalhost || localStorage.getItem('grime-quotebot') === '1';
    if (!enabled) return;
  } catch {
    // If localStorage is blocked (private mode etc.), require the query param each time.
    if (!/[?&]quotebot=1(?:&|$)/.test(window.location.search)) return;
  }

  window.__grimeBotLoaded = true;

  // ── Styles ────────────────────────────────────────────────────────────────
  const css = `
    .gb-root {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      font-family: 'Open Sans', system-ui, sans-serif;
      color: #F0EAD6;
    }

    /* Closed-state bubble */
    .gb-bubble {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      border: 2px solid #E8872A;
      cursor: pointer;
      background: radial-gradient(circle at 50% 60%, #2a2018 0%, #111111 70%);
      box-shadow: 0 10px 28px rgba(178, 34, 34, 0.45),
                  0 4px 10px rgba(0, 0, 0, 0.4),
                  0 0 24px rgba(232, 135, 42, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1),
                  box-shadow 180ms ease;
      outline: none;
    }
    .gb-bubble:hover {
      transform: translateY(-2px) scale(1.04);
      box-shadow: 0 14px 32px rgba(178, 34, 34, 0.55),
                  0 6px 14px rgba(0, 0, 0, 0.45),
                  0 0 32px rgba(232, 135, 42, 0.55);
    }
    .gb-bubble:focus-visible { box-shadow: 0 0 0 3px #F0EAD6, 0 10px 28px rgba(178, 34, 34, 0.45); }
    .gb-bubble:active { transform: translateY(0) scale(0.98); }
    .gb-bubble svg { width: 34px; height: 34px; filter: drop-shadow(0 0 6px rgba(232, 135, 42, 0.6)); }

    /* Subtle breathing glow so it reads as "on" / active */
    @keyframes gb-ember {
      0%, 100% { box-shadow: 0 10px 28px rgba(178, 34, 34, 0.45), 0 4px 10px rgba(0, 0, 0, 0.4), 0 0 22px rgba(232, 135, 42, 0.3); }
      50%      { box-shadow: 0 10px 28px rgba(178, 34, 34, 0.5),  0 4px 10px rgba(0, 0, 0, 0.4), 0 0 34px rgba(232, 135, 42, 0.55); }
    }
    .gb-bubble { animation: gb-ember 2.8s ease-in-out infinite; }
    .gb-bubble:hover { animation-play-state: paused; }

    /* Nudge label beside bubble */
    .gb-nudge {
      position: absolute;
      bottom: 16px;
      right: 80px;
      background: #1C1C1C;
      border: 1px solid rgba(232, 135, 42, 0.4);
      color: #F0EAD6;
      padding: 10px 14px;
      border-radius: 10px;
      font-family: 'Oswald', sans-serif;
      font-size: 13px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transform: translateX(8px);
      pointer-events: none;
      transition: opacity 240ms ease, transform 240ms ease;
    }
    .gb-nudge.gb-show { opacity: 1; transform: translateX(0); }
    .gb-nudge::after {
      content: '';
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%) rotate(45deg);
      width: 10px;
      height: 10px;
      background: #1C1C1C;
      border-right: 1px solid rgba(232, 135, 42, 0.4);
      border-top: 1px solid rgba(232, 135, 42, 0.4);
    }

    /* Open panel */
    .gb-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 48px);
      background: #111111;
      border: 1px solid rgba(232, 135, 42, 0.3);
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 8px 20px rgba(178, 34, 34, 0.2);
      display: none;
      flex-direction: column;
      overflow: hidden;
      transform-origin: bottom right;
      animation: gb-pop 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .gb-panel.gb-open { display: flex; }
    @keyframes gb-pop {
      from { opacity: 0; transform: scale(0.85) translateY(20px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    .gb-header {
      background: #1C1C1C;
      border-bottom: 2px solid #B22222;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .gb-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .gb-avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #E8872A 0%, #B22222 100%);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .gb-avatar svg { width: 18px; height: 18px; color: #F0EAD6; }
    .gb-title {
      font-family: 'Oswald', sans-serif;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #F0EAD6;
      line-height: 1.2;
    }
    .gb-subtitle {
      font-size: 11px;
      color: #C8C0AD;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .gb-status-dot {
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #4ade80;
      margin-right: 6px;
      vertical-align: middle;
    }
    .gb-close {
      background: transparent;
      border: none;
      color: #C8C0AD;
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 160ms ease, color 160ms ease;
    }
    .gb-close:hover { background: rgba(178, 34, 34, 0.25); color: #F0EAD6; }
    .gb-close:focus-visible { outline: 2px solid #E8872A; outline-offset: 1px; }
    .gb-close svg { width: 18px; height: 18px; }

    .gb-messages {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: #B22222 #1C1C1C;
    }
    .gb-messages::-webkit-scrollbar { width: 6px; }
    .gb-messages::-webkit-scrollbar-track { background: #1C1C1C; }
    .gb-messages::-webkit-scrollbar-thumb { background: #B22222; border-radius: 3px; }

    .gb-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      animation: gb-msg-in 220ms ease-out;
    }
    @keyframes gb-msg-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .gb-msg strong { color: #E8872A; font-weight: 600; }
    .gb-msg-bot {
      align-self: flex-start;
      background: #1C1C1C;
      border: 1px solid rgba(232, 135, 42, 0.2);
      color: #F0EAD6;
      border-bottom-left-radius: 4px;
    }
    .gb-msg-user {
      align-self: flex-end;
      background: linear-gradient(135deg, #E8872A 0%, #B22222 100%);
      color: #F0EAD6;
      border-bottom-right-radius: 4px;
      font-weight: 500;
    }

    .gb-typing {
      display: inline-flex;
      gap: 4px;
      padding: 12px 14px;
    }
    .gb-typing span {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #C8C0AD;
      animation: gb-dot 1.2s infinite ease-in-out;
    }
    .gb-typing span:nth-child(2) { animation-delay: 0.15s; }
    .gb-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes gb-dot {
      0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
      30% { opacity: 1; transform: translateY(-3px); }
    }

    .gb-input-wrap {
      border-top: 1px solid rgba(232, 135, 42, 0.2);
      background: #1C1C1C;
      padding: 12px;
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .gb-input {
      flex: 1 1 auto;
      background: #111111;
      border: 1px solid rgba(200, 192, 173, 0.15);
      color: #F0EAD6;
      padding: 10px 12px;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.4;
      resize: none;
      max-height: 100px;
      min-height: 40px;
      outline: none;
      transition: border-color 160ms ease;
    }
    .gb-input:focus { border-color: #E8872A; }
    .gb-input::placeholder { color: #6b6355; }
    .gb-send {
      background: linear-gradient(135deg, #E8872A 0%, #B22222 100%);
      border: none;
      color: #F0EAD6;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 140ms ease, box-shadow 140ms ease;
    }
    .gb-send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(178, 34, 34, 0.4); }
    .gb-send:active:not(:disabled) { transform: translateY(0); }
    .gb-send:disabled { opacity: 0.4; cursor: not-allowed; }
    .gb-send:focus-visible { outline: 2px solid #F0EAD6; outline-offset: 2px; }
    .gb-send svg { width: 18px; height: 18px; }

    .gb-footer-note {
      padding: 6px 12px 10px;
      background: #1C1C1C;
      font-size: 10.5px;
      color: #6b6355;
      text-align: center;
      letter-spacing: 0.3px;
    }

    /* Mobile */
    @media (max-width: 520px) {
      .gb-root { bottom: 16px; right: 16px; }
      .gb-panel {
        bottom: 0;
        right: 0;
        width: 100vw;
        max-width: 100vw;
        height: 100vh;
        max-height: 100vh;
        border-radius: 0;
        border: none;
      }
      .gb-nudge { display: none; }
    }
  `;

  const style = document.createElement('style');
  style.setAttribute('data-grime-bot', '');
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'gb-root';
  root.innerHTML = `
    <div class="gb-nudge" id="gb-nudge">Get an instant quote →</div>
    <button class="gb-bubble" id="gb-bubble" aria-label="Open Grime to Prime quote bot">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="gb-flame-grad" x1="50%" y1="100%" x2="50%" y2="0%">
            <stop offset="0%" stop-color="#FFD166"/>
            <stop offset="55%" stop-color="#E8872A"/>
            <stop offset="100%" stop-color="#B22222"/>
          </linearGradient>
        </defs>
        <path fill="url(#gb-flame-grad)" d="M12 2c.6 2.4-.4 4-1.5 5.5C9.1 9.3 8 10.8 8 13a4 4 0 0 0 8 0c0-1-.3-1.9-.8-2.7 1.8.6 3.8 2.5 3.8 5.7a7 7 0 1 1-14 0c0-3.2 2-5 3-7 .8-1.7.7-4.4 4-7Z"/>
        <path fill="#FFF3C4" opacity="0.9" d="M12 13c.2 1-.3 1.7-.9 2.3-.5.5-.9 1-.9 1.8a1.8 1.8 0 0 0 3.6 0c0-.5-.2-.9-.5-1.3.9.3 1.7 1.1 1.7 2.5a2.5 2.5 0 1 1-5 0c0-1.3.7-2 1.2-2.8.4-.7.5-1.5.8-2.5Z"/>
      </svg>
    </button>
    <div class="gb-panel" id="gb-panel" role="dialog" aria-label="Grime to Prime quote bot" aria-modal="false">
      <div class="gb-header">
        <div class="gb-header-left">
          <div class="gb-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 2s1 2 0 4-2 3-2 5a4 4 0 0 0 8 0c0-1-.5-2-1-3 1 0 3 1 3 4a6 6 0 1 1-12 0c0-3 2-5 2-7 0-2 1-3 2-3Z"/>
            </svg>
          </div>
          <div>
            <div class="gb-title">Grime Bot</div>
            <div class="gb-subtitle"><span class="gb-status-dot"></span>Usually replies instantly</div>
          </div>
        </div>
        <button class="gb-close" id="gb-close" aria-label="Close chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
          </svg>
        </button>
      </div>
      <div class="gb-messages" id="gb-messages" aria-live="polite"></div>
      <div class="gb-input-wrap">
        <textarea
          class="gb-input"
          id="gb-input"
          placeholder="Type your message…"
          rows="1"
          aria-label="Your message"
        ></textarea>
        <button class="gb-send" id="gb-send" aria-label="Send message" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div class="gb-footer-note">Quotes are firm for conditions as described · Adjustable on-site</div>
    </div>
  `;
  document.body.appendChild(root);

  // ── State + refs ──────────────────────────────────────────────────────────
  const bubble = document.getElementById('gb-bubble');
  const nudge = document.getElementById('gb-nudge');
  const panel = document.getElementById('gb-panel');
  const closeBtn = document.getElementById('gb-close');
  const msgContainer = document.getElementById('gb-messages');
  const input = document.getElementById('gb-input');
  const sendBtn = document.getElementById('gb-send');

  const state = {
    open: false,
    messages: [], // [{role: 'user'|'assistant', content: string}]
    sending: false,
    started: false
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function renderMessage(role, content) {
    const el = document.createElement('div');
    el.className = 'gb-msg ' + (role === 'user' ? 'gb-msg-user' : 'gb-msg-bot');
    // Basic markdown-ish: **bold** → <strong>; newlines → <br>
    const safe = escapeHtml(content)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    el.innerHTML = safe;
    msgContainer.appendChild(el);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    return el;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'gb-msg gb-msg-bot gb-typing-wrap';
    el.innerHTML = '<div class="gb-typing"><span></span><span></span><span></span></div>';
    el.style.padding = '0';
    el.style.border = 'none';
    el.style.background = 'transparent';
    msgContainer.appendChild(el);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    return el;
  }

  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  async function sendMessage(text) {
    if (state.sending || !text.trim()) return;
    state.sending = true;
    sendBtn.disabled = true;

    state.messages.push({ role: 'user', content: text });
    renderMessage('user', text);

    input.value = '';
    autoResize();

    const typingEl = showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: state.messages })
      });
      const data = await res.json();
      typingEl.remove();
      if (data.reply) {
        state.messages.push({ role: 'assistant', content: data.reply });
        renderMessage('assistant', data.reply);
      } else if (data.error) {
        renderMessage('assistant', "Sorry — I hit a snag. Try again?");
      }
    } catch (e) {
      typingEl.remove();
      renderMessage('assistant', "Connection glitch. Give it another try?");
      console.error('[grime-bot]', e);
    }

    state.sending = false;
    sendBtn.disabled = !input.value.trim();
    input.focus();
  }

  async function startConversation() {
    if (state.started) return;
    state.started = true;
    const typingEl = showTyping();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] })
      });
      const data = await res.json();
      typingEl.remove();
      if (data.reply) {
        state.messages.push({ role: 'assistant', content: data.reply });
        renderMessage('assistant', data.reply);
      }
    } catch (e) {
      typingEl.remove();
      renderMessage('assistant', "Hey! Connection issue on my end — refresh and try again?");
    }
  }

  function openPanel() {
    state.open = true;
    panel.classList.add('gb-open');
    bubble.style.display = 'none';
    nudge.classList.remove('gb-show');
    if (!state.started) startConversation();
    setTimeout(() => input.focus(), 300);
  }

  function closePanel() {
    state.open = false;
    panel.classList.remove('gb-open');
    bubble.style.display = 'flex';
  }

  // ── Wire-up ───────────────────────────────────────────────────────────────
  bubble.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim() || state.sending;
    autoResize();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.value.trim()) sendMessage(input.value);
    }
  });
  sendBtn.addEventListener('click', () => {
    if (input.value.trim()) sendMessage(input.value);
  });

  // Show the nudge briefly after the page settles
  setTimeout(() => {
    if (!state.open) nudge.classList.add('gb-show');
  }, 2500);
  setTimeout(() => nudge.classList.remove('gb-show'), 8000);
})();
