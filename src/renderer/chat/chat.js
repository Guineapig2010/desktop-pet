const api = window.buddy;
const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const input = $('input');
const sendBtn = $('send');
let streaming = null; // { id, el }
let collapsed = false;

const TAGS = { scripted: 'Albuquerque campaign', offline: 'Offline · scripted reply', ai: '', helper: 'Personal helper' };
let helper = { sharing: false, live: false, busy: false };
let helperMode = 'explain';

function render(m) {
  if (m.role === 'system') {
    const el = document.createElement('div');
    el.className = `msg system ${m.source === 'notice' ? 'notice' : ''}`;
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
  if (helper.sharing && helper.live) {
    input.value = '';
    autosize();
    return askHelper(text);
  }
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

// ── Personal Helper ─────────────────────────────────────────────────────
async function askHelper(text) {
  if (helper.busy) return;
  if (!helper.sharing) {
    openPicker(text);
    return;
  }
  $('askScreen').disabled = true;
  try {
    await api.helperAsk(text, helperMode);
  } finally {
    $('askScreen').disabled = false;
  }
}

function renderHelper(s) {
  helper = s;
  for (const c of s.confirms || []) if (!messagesEl.querySelector(`.confirm[data-id="${c.id}"]`)) showConfirm(c);
  $('shareBtn').classList.toggle('hidden', s.sharing);
  $('sharingPill').classList.toggle('hidden', !s.sharing);
  $('sharingName').textContent = s.sourceName || '';
  $('liveToggle').checked = !!s.live;
  $('liveToggle').disabled = !s.sharing;
  $('askScreen').textContent = s.busy ? '⏳ Working… (Esc stops)' : '📸 Ask about my screen';
  $('askScreen').disabled = !!s.busy;
  input.placeholder = s.sharing && s.live ? (helperMode === 'do' ? 'Tell him what to do on your screen…' : 'Ask about your screen…') : 'Ask him anything…';
}

let pendingAsk = null;
async function openPicker(thenAsk) {
  pendingAsk = thenAsk || null;
  $('picker').classList.remove('hidden');
  const grid = $('sources');
  grid.innerHTML = '<div class="empty">Loading…</div>';
  const perm = await api.helperPermissions();
  const note = $('permNote');
  const notes = [];
  if (perm.platform === 'darwin' && perm.screen !== 'granted') notes.push('macOS needs <b>Screen Recording</b> permission for this app (System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording). <a href="#" data-perm="screen">Open settings</a>. After allowing it, quit and reopen the app.');
  if (perm.platform === 'darwin' && !perm.accessibility) notes.push('To click and type for you he also needs <b>Accessibility</b> permission. <a href="#" data-perm="accessibility">Open settings</a>. (Explaining and pointing work without it.)');
  note.innerHTML = notes.join('<br/><br/>');
  note.classList.toggle('hidden', !notes.length);
  note.querySelectorAll('a[data-perm]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    api.helperOpenPermission(a.dataset.perm);
  }));
  let list = [];
  try {
    list = await api.helperSources();
  } catch (e) {
    grid.innerHTML = `<div class="empty">Couldn't list screens: ${e.message}</div>`;
    return;
  }
  grid.innerHTML = '';
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'src';
    b.dataset.id = s.id;
    b.innerHTML = `${s.thumbnail ? `<img src="${s.thumbnail}" alt="" />` : '<img alt="" />'}<span class="k">${s.kind === 'screen' ? 'Display' : 'Window'}</span><br/>`;
    b.appendChild(document.createTextNode(s.name));
    b.addEventListener('click', async () => {
      await api.helperShare(s);
      closePicker();
      if (pendingAsk) {
        const t = pendingAsk;
        pendingAsk = null;
        askHelper(t);
      }
    });
    grid.appendChild(b);
  }
  if (!list.length) grid.innerHTML = '<div class="empty">Nothing to share was found. On macOS, allow Screen Recording first.</div>';
}
function closePicker() {
  $('picker').classList.add('hidden');
}

function setMode(m) {
  helperMode = m;
  $('modeExplain').classList.toggle('on', m === 'explain');
  $('modeDo').classList.toggle('on', m === 'do');
  renderHelper(helper);
}

$('shareBtn').addEventListener('click', () => openPicker());
$('pickerClose').addEventListener('click', closePicker);
$('stopShare').addEventListener('click', () => api.helperStop());
$('askScreen').addEventListener('click', () => {
  const t = input.value.trim();
  input.value = '';
  autosize();
  askHelper(t || "Explain what I'm looking at.");
});
$('modeExplain').addEventListener('click', () => setMode('explain'));
$('modeDo').addEventListener('click', () => setMode('do'));
$('liveToggle').addEventListener('change', () => api.helperLive($('liveToggle').checked));
api.onHelperStatus(renderHelper);
api.onHelperOpenPicker(() => openPicker());
api.onHelperConfirm(showConfirm);
function showConfirm({ id, text }) {
  if (messagesEl.querySelector(`.confirm[data-id="${id}"]`)) return;
  document.querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = 'confirm';
  el.dataset.id = id;
  el.innerHTML = '<div class="q"></div><button class="yes">Yes, do it</button><button class="no">No</button>';
  el.querySelector('.q').textContent = `⚠️ Before I do this, are you sure? ${text}`;
  const answer = (ok) => {
    el.classList.add('done');
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    api.helperConfirmReply(id, ok);
  };
  el.querySelector('.yes').addEventListener('click', () => answer(true));
  el.querySelector('.no').addEventListener('click', () => answer(false));
  messagesEl.appendChild(el);
  scroll();
}
api.helperState().then(renderHelper);

api.onAiStatus(refreshStatus);
api.onSettings((s) => {
  $('name').textContent = s.petName || 'General Fok';
  refreshStatus();
});

(async () => {
  const s = await api.getSettings();
  $('name').textContent = s.petName || 'General Fok';
  const hist = await api.chatHistory();
  hist.slice(-120).forEach(add);
  showEmpty();
  refreshStatus();
  input.focus();
})();

window.__chat = { send: (t) => { input.value = t; return send(); }, setMode, openPicker, askHelper };
