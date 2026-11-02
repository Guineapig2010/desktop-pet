const api = window.buddy;
const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const input = $('input');
const sendBtn = $('send');
let streaming = null; // { id, el }
let collapsed = false;

const TAGS = { scripted: 'Albuquerque campaign', offline: 'Offline · scripted reply', ai: '' };

function render(m) {
  if (m.role === 'system') {
    const el = document.createElement('div');
    el.className = 'msg system';
    el.textContent = m.text;
    return el;
  }
  const el = document.createElement('div');
  el.className = `msg ${m.role} ${m.source || ''}`;
  el.dataset.id = m.id || '';
  const tag = TAGS[m.source];
  if (tag && m.role === 'assistant') {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    el.appendChild(t);
  }
  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = m.text;
  el.appendChild(body);
  return el;
}

function add(m) {
  document.querySelector('.empty')?.remove();
  if (m.id && messagesEl.querySelector(`[data-id="${m.id}"]`)) return;
  messagesEl.appendChild(render(m));
  scroll();
}

function scroll() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showEmpty() {
  if (messagesEl.children.length) return;
  const e = document.createElement('div');
  e.className = 'empty';
  e.innerHTML = 'Say hi! Ask him anything —<br/>he\'ll answer (and probably bring up Albuquerque).';
  messagesEl.appendChild(e);
}

async function refreshStatus() {
  const st = await api.aiStatus();
  const s = $('status');
  s.className = `status ${st.configured ? 'ai' : 'offline'}`;
  $('statusText').textContent = st.label;
  $('offlineBanner').classList.toggle('hidden', st.configured);
}

async function send() {
  if (streaming) {
    api.chatStop();
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autosize();
  sendBtn.disabled = true;
  const typing = document.createElement('div');
  typing.className = 'msg assistant typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  setTimeout(() => {
    if (!streaming && sendBtn.disabled) {
      messagesEl.appendChild(typing);
      scroll();
    }
  }, 120);
  try {
    await api.chatSend(text);
  } finally {
    typing.remove();
    sendBtn.disabled = false;
    input.focus();
  }
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(120, input.scrollHeight)}px`;
}

api.onChatMessage((m) => {
  if (streaming && m.id === streaming.id) return;
  add(m);
});

api.onChatStream((ev) => {
  if (ev.start) {
    document.querySelector('.typing')?.remove();
    const el = render({ role: 'assistant', text: '', source: 'ai', id: ev.id });
    messagesEl.appendChild(el);
    streaming = { id: ev.id, el };
    sendBtn.textContent = 'Stop';
    sendBtn.classList.add('stop');
    sendBtn.disabled = false;
    return;
  }
  if (!streaming || ev.id !== streaming.id) return;
  if (ev.delta) {
    streaming.el.querySelector('.body').textContent += ev.delta;
    scroll();
  }
  if (ev.done || ev.error) {
    if (ev.error && !streaming.el.querySelector('.body').textContent) streaming.el.remove();
    streaming = null;
    sendBtn.textContent = 'Send';
    sendBtn.classList.remove('stop');
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
  if (e.key === 'Escape') api.closeWindow();
});
input.addEventListener('input', autosize);
sendBtn.addEventListener('click', send);
$('closeBtn').addEventListener('click', () => api.closeWindow());
$('settingsBtn').addEventListener('click', () => api.openSettings());
$('setupLink').addEventListener('click', (e) => {
  e.preventDefault();
  api.openSettings();
});
$('collapseBtn').addEventListener('click', async () => {
  collapsed = !collapsed;
  document.body.classList.toggle('collapsed', collapsed);
  $('collapseBtn').textContent = collapsed ? '▢' : '–';
  $('collapseBtn').title = collapsed ? 'Expand' : 'Minimize';
  await api.chatCollapse(collapsed);
  if (!collapsed) input.focus();
});
$('name').addEventListener('dblclick', () => $('collapseBtn').click());

api.onAiStatus(refreshStatus);
api.onSettings((s) => {
  $('name').textContent = s.petName || 'Buddy';
  refreshStatus();
});

(async () => {
  const s = await api.getSettings();
  $('name').textContent = s.petName || 'Buddy';
  const hist = await api.chatHistory();
  hist.slice(-120).forEach(add);
  showEmpty();
  refreshStatus();
  input.focus();
})();

window.__chat = { send: (t) => { input.value = t; return send(); } };
