const api = window.buddy;
const $ = (id) => document.getElementById(id);
let s = await api.getSettings();
const status = await api.status();

const sliders = {
  size: (v) => `${Math.round(v * 100)}%`,
  headScale: (v) => `${Math.round(v * 100)}%`,
  speed: (v) => `${Math.round(v * 100)}%`,
  chaseFrequency: (v) => (v == 0 ? 'never' : v < 0.3 ? 'rarely' : v < 0.7 ? 'sometimes' : 'often'),
  dialogueFrequency: (v) => (v == 0 ? 'never' : v < 0.3 ? 'rarely' : v < 0.7 ? 'sometimes' : 'often'),
  volume: (v) => `${Math.round(v * 100)}%`,
};
const checks = ['paused', 'sound', 'useWindows', 'cursorRestraint', 'lowPower', 'showInDock'];

function fill() {
  for (const [k, fmt] of Object.entries(sliders)) {
    $(k).value = s[k];
    $(`${k}Out`).textContent = fmt(s[k]);
  }
  for (const k of checks) $(k).checked = !!s[k];
  $('petName').value = s.petName;
  $('userName').value = s.userName;
  $('character').value = s.character;
  $('provider').value = s.ai.provider;
  $('anthropicModel').value = s.ai.anthropicModel;
  $('openaiBaseUrl').value = s.ai.openaiBaseUrl;
  $('openaiModel').value = s.ai.openaiModel;
  document.querySelectorAll('.provider').forEach((el) => el.classList.toggle('on', el.classList.contains(s.ai.provider)));
}

const save = (patch) => api.setSettings(patch).then((n) => (s = n));

for (const [k, fmt] of Object.entries(sliders)) {
  $(k).addEventListener('input', () => {
    const v = parseFloat($(k).value);
    $(`${k}Out`).textContent = fmt(v);
    save({ [k]: v });
  });
}
for (const k of checks) $(k).addEventListener('change', () => save({ [k]: $(k).checked }));
for (const k of ['petName', 'userName']) $(k).addEventListener('change', () => save({ [k]: $(k).value.trim() || (k === 'petName' ? 'General Fok' : 'pal') }));
$('character').addEventListener('change', () => save({ character: $('character').value }));
$('provider').addEventListener('change', () => {
  save({ ai: { provider: $('provider').value } }).then(fill);
  $('testResult').textContent = '';
});
for (const k of ['anthropicModel', 'openaiBaseUrl', 'openaiModel']) $(k).addEventListener('change', () => save({ ai: { [k]: $(k).value.trim() } }));

async function keyInfo() {
  const info = await api.secretInfo();
  const txt = (src) => (src === 'keychain' ? '✓ A key is saved (encrypted with the Keychain).' : src === 'environment' ? '✓ Using the key from your environment variable.' : src === 'session' ? '✓ Key kept in memory for this session only (OS encryption unavailable).' : 'No key saved yet.');
  $('anthropicKeyHint').textContent = txt(info.anthropic);
  $('openaiKeyHint').textContent = txt(info.openai);
}
async function saveKey(name, inputId) {
  const v = $(inputId).value.trim();
  if (!v) return;
  await api.setSecret(name, v);
  $(inputId).value = '';
  keyInfo();
}
$('saveAnthropic').addEventListener('click', () => saveKey('anthropic', 'anthropicKey'));
$('saveOpenai').addEventListener('click', () => saveKey('openai', 'openaiKey'));
$('clearAnthropic').addEventListener('click', () => api.clearSecret('anthropic').then(keyInfo));
$('clearOpenai').addEventListener('click', () => api.clearSecret('openai').then(keyInfo));
$('testAi').addEventListener('click', async () => {
  const r = $('testResult');
  r.className = 'result';
  r.textContent = 'Testing…';
  const res = await api.aiTest();
  r.className = `result ${res.ok ? 'ok' : 'bad'}`;
  r.textContent = res.ok ? `✓ Connected. He says: "${res.text.trim().slice(0, 80)}"` : `✗ ${res.error}`;
});

$('talkBtn').addEventListener('click', () => api.petCommand('talk'));
$('chaseBtn').addEventListener('click', () => api.petCommand('chase'));
$('summonBtn').addEventListener('click', () => api.petCommand('summon'));
$('importBtn').addEventListener('click', () => api.openImporter());
$('resetStory').addEventListener('click', async () => {
  await api.resetStory();
  $('resetStory').textContent = 'Storyline reset ✓';
});
$('quitBtn').addEventListener('click', () => api.quit());
document.querySelectorAll('a[data-url]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  api.openExternal(a.dataset.url);
}));

function statusText(st) {
  $('windowHint').textContent = st.windows?.reason || '';
}
statusText(status);
api.onStatus(statusText);
$('restraintHint').textContent = status.restraintSupported ? 'Off by default. Purely a gag: the pointer is tugged back towards his hands for at most 1.5 seconds; pull hard or press Esc to break free.' : 'Only available on macOS. On this system the grab is visual only.';
if (!status.restraintSupported) $('cursorRestraint').disabled = true;
if (status.platform !== 'darwin') document.querySelectorAll('.mac-only').forEach((e) => (e.style.display = 'none'));
$('charHint').textContent = status.character.source === 'imported' ? 'Using the photo you imported.' : status.character.source === 'bundled' ? 'Using the built-in photo character.' : 'No photo character yet: he is drawn as a cartoon until you import a photo.';
$('about').textContent = `Version ${status.version} · settings and chat history live in ${status.userData}`;
api.onSettings((n) => {
  s = n;
  fill();
});
fill();
keyInfo();
