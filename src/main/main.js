// Albuquerque Buddy — Electron main process.
import { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog, protocol, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JsonStore, DEFAULT_SETTINGS } from './store.js';
import { Secrets } from './secrets.js';
import { WindowTracker } from './windowTracker.js';
import { Restraint } from './restraint.js';
import { personaPrompt, chatAnthropic, chatOpenAICompatible, offlineReply, explainError } from './ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const RENDERER = path.join(ROOT, 'src/renderer');
const PRELOAD = path.join(ROOT, 'src/preload/preload.cjs');
const HELPERS = path.join(here, 'helpers');
const ASSETS = path.join(ROOT, 'assets');
const TEST = process.env.BUDDY_TEST === '1';
const isMac = process.platform === 'darwin';

if (TEST && process.env.BUDDY_USER_DATA) app.setPath('userData', process.env.BUDDY_USER_DATA);
app.setName('Albuquerque Buddy');

protocol.registerSchemesAsPrivileged([{ scheme: 'buddy', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let settings, storyStore, chatStore, secrets, tracker, restraint;
let overlay = null, chatWin = null, settingsWin = null, importerWin = null, tray = null;
let petState = {};
let cursorTimer = null;
let quitting = false;
const log = (...a) => {
  if (TEST || process.env.BUDDY_DEBUG) console.log('[buddy]', ...a);
};

// ── helpers ──────────────────────────────────────────────────────────────────
const userCharDir = () => path.join(app.getPath('userData'), 'character');
function characterInfo() {
  if (fs.existsSync(path.join(userCharDir(), 'rig.json'))) return { url: 'buddy://character', source: 'imported' };
  if (fs.existsSync(path.join(ASSETS, 'character/photo/rig.json'))) return { url: '../../../assets/character/photo', source: 'bundled' };
  return { url: null, source: 'none' };
}

function iconImage(name) {
  const p = path.join(ASSETS, name);
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
}

function targetDisplay() {
  const id = settings.get().displayId;
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data);
}

function sendOverlay(channel, data) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, data);
}

function command(cmd, data) {
  sendOverlay('command', { cmd, data });
}

// ── overlay (the pet's transparent stage) ───────────────────────────────────
function createOverlay() {
  const b = targetDisplay().workArea;
  overlay = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    roundedCorners: false,
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(RENDERER, 'overlay/index.html'));
  overlay.once('ready-to-show', () => {
    if (!settings.get().hidden) overlay.showInactive();
  });
  overlay.on('closed', () => (overlay = null));
  overlay.webContents.on('console-message', (e) => {
    const msg = e.message ?? arguments[2];
    if (TEST || process.env.BUDDY_DEBUG) console.log('[overlay]', msg);
  });
}

function fitOverlay() {
  if (!overlay) return;
  const b = targetDisplay().workArea;
  overlay.setBounds(b);
}

function overlayOrigin() {
  return overlay ? overlay.getBounds() : targetDisplay().workArea;
}

// cursor position, polled (works over every app, no permission needed)
let fakeCursor = null;
function startCursorPolling() {
  clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!overlay) return;
    const p = fakeCursor || screen.getCursorScreenPoint();
    const o = overlayOrigin();
    sendOverlay('cursor', { x: p.x - o.x, y: p.y - o.y });
  }, 33);
}

function onWindows(list) {
  const o = overlayOrigin();
  sendOverlay(
    'windows',
    list.map((w) => ({ ...w, x: w.x - o.x, y: w.y - o.y })),
  );
}

// ── chat panel ───────────────────────────────────────────────────────────────
function openChat() {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.show();
    chatWin.focus();
    return chatWin;
  }
  const wa = targetDisplay().workArea;
  const w = 380, h = 560;
  const pos = settings.get().chatBounds || { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 40, width: w, height: h };
  chatWin = new BrowserWindow({
    ...pos,
    minWidth: 300,
    minHeight: 56,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Chat',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  chatWin.setAlwaysOnTop(true, 'floating', 1);
  chatWin.loadFile(path.join(RENDERER, 'chat/index.html'));
  chatWin.once('ready-to-show', () => chatWin.show());
  const saveBounds = () => {
    if (!chatWin || chatWin.isDestroyed() || chatWin.__collapsed) return;
    settings.set({ chatBounds: chatWin.getBounds() });
  };
  chatWin.on('moved', saveBounds);
  chatWin.on('resized', saveBounds);
  chatWin.on('closed', () => (chatWin = null));
  return chatWin;
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 620,
    height: 780,
    minWidth: 480,
    minHeight: 500,
    title: 'Albuquerque Buddy — Settings',
    show: false,
    backgroundColor: '#1d1a20',
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings/index.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
  return settingsWin;
}

function openImporter() {
  if (importerWin && !importerWin.isDestroyed()) {
    importerWin.show();
    importerWin.focus();
    return importerWin;
  }
  importerWin = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Use my photo',
    show: false,
    backgroundColor: '#1d1a20',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  importerWin.loadFile(path.join(RENDERER, 'importer/index.html'));
  importerWin.once('ready-to-show', () => importerWin.show());
  importerWin.on('closed', () => (importerWin = null));
  return importerWin;
}

// ── settings changes ─────────────────────────────────────────────────────────
function applySettings(patch) {
  const prev = settings.get();
  const next = settings.set(patch);
  if (patch.displayId !== undefined && patch.displayId !== prev.displayId) fitOverlay();
  if (patch.hidden !== undefined && overlay) next.hidden ? overlay.hide() : overlay.showInactive();
  if (isMac && patch.showInDock !== undefined) next.showInDock ? app.dock.show() : app.dock.hide();
  if (patch.useWindows !== undefined) next.useWindows ? tracker.start() : (tracker.stop(), onWindows([]));
  broadcast('settings', next);
  refreshMenus();
  return next;
}

// ── menus ────────────────────────────────────────────────────────────────────
function petMenuTemplate() {
  const s = settings.get();
  return [
    { label: 'Chat with him…', click: openChat },
    { label: 'Talk about Albuquerque', click: () => command('talk') },
    { label: 'Chase my cursor!', click: () => command('chase') },
    { type: 'separator' },
    { label: 'Bigger', click: () => applySettings({ size: Math.min(3, Math.round(s.size * 1.15 * 100) / 100) }) },
    { label: 'Smaller', click: () => applySettings({ size: Math.max(0.4, Math.round((s.size / 1.15) * 100) / 100) }) },
    { label: s.paused ? 'Resume' : 'Pause', click: () => applySettings({ paused: !s.paused }) },
    { label: s.hidden ? 'Show him' : 'Hide him', click: () => applySettings({ hidden: !s.hidden }) },
    { label: 'Bring him back to the middle', click: () => command('summon') },
    { type: 'separator' },
    { label: 'Use my photo…', click: openImporter },
    { label: 'Settings…', accelerator: isMac ? 'Cmd+,' : 'Ctrl+,', click: openSettings },
    { type: 'separator' },
    { label: 'Quit Albuquerque Buddy', accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q', click: () => quitApp() },
  ];
}

function refreshMenus() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(petMenuTemplate()));
  const appMenu = Menu.buildFromTemplate([
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { type: 'separator' },
              { label: 'Quit Albuquerque Buddy', accelerator: 'Cmd+Q', click: () => quitApp() },
            ],
          },
        ]
      : []),
    { role: 'editMenu' },
    {
      label: 'Buddy',
      submenu: petMenuTemplate().filter((i) => !i.accelerator || i.label.startsWith('Quit') === false),
    },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(appMenu);
}

function createTray() {
  let img = iconImage(isMac ? 'trayTemplate.png' : 'tray.png');
  if (isMac && !img.isEmpty()) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Albuquerque Buddy');
  if (img.isEmpty()) tray.setTitle?.('ABQ');
  refreshMenus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

// ── chat orchestration ──────────────────────────────────────────────────────
let chatAbort = null;
let pendingAnswer = null;

function appendChat(msg) {
  const list = chatStore.get().messages;
  const m = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), ...msg };
  list.push(m);
  while (list.length > 300) list.shift();
  chatStore.saveSoon();
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('chat:message', m);
  return m;
}

function aiStatus() {
  const s = settings.get();
  const p = s.ai.provider;
  if (p === 'anthropic') {
    const ok = secrets.has('anthropic');
    return { provider: p, configured: ok, label: ok ? `AI · Claude (${s.ai.anthropicModel})` : 'Offline · add your Anthropic key in Settings', model: s.ai.anthropicModel, keySource: secrets.source('anthropic') };
  }
  if (p === 'openai') {
    const local = /localhost|127\.0\.0\.1/.test(s.ai.openaiBaseUrl);
    const ok = (local || secrets.has('openai')) && !!s.ai.openaiModel;
    return { provider: p, configured: ok, label: ok ? `AI · ${s.ai.openaiModel}` : 'Offline · finish AI setup in Settings', model: s.ai.openaiModel, keySource: secrets.source('openai') };
  }
  return { provider: 'none', configured: false, label: 'Offline · scripted replies (not AI)' };
}

async function askOverlayIfAnswer(text) {
  if (!overlay) return false;
  return new Promise((resolve) => {
    pendingAnswer = resolve;
    command('chatUserMessage', { text });
    setTimeout(() => {
      if (pendingAnswer === resolve) {
        pendingAnswer = null;
        resolve(false);
      }
    }, 400);
  });
}

async function handleChatSend(text, sender) {
  text = String(text || '').trim().slice(0, 4000);
  if (!text) return { ok: false };
  appendChat({ role: 'user', text, source: 'user' });
  if (await askOverlayIfAnswer(text)) return { ok: true, handledByStory: true };

  const s = settings.get();
  const st = aiStatus();
  const persona = personaPrompt({ petName: s.petName, userName: s.userName });
  const ctx = { storySummary: petState.storySummary || '' };
  const history = chatStore.get().messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const replyId = `r${Date.now().toString(36)}`;
  const send = (ch, d) => !sender.isDestroyed() && sender.send(ch, d);

  if (!st.configured) {
    const reply = offlineReply(text, { userName: s.userName, petName: s.petName });
    await new Promise((r) => setTimeout(r, 350));
    const m = appendChat({ role: 'assistant', text: reply, source: 'offline' });
    command('chatReply', { text: reply });
    return { ok: true, message: m };
  }

  chatAbort?.abort();
  chatAbort = new AbortController();
  command('chatThinking');
  send('chat:stream', { id: replyId, start: true });
  let full = '';
  const onDelta = (d) => {
    full += d;
    send('chat:stream', { id: replyId, delta: d });
  };
  try {
    if (st.provider === 'anthropic') {
      await chatAnthropic({ apiKey: secrets.get('anthropic'), model: s.ai.anthropicModel, history, persona, ctx, onDelta, signal: chatAbort.signal, baseURL: process.env.BUDDY_ANTHROPIC_BASE_URL || undefined });
    } else {
      await chatOpenAICompatible({ apiKey: secrets.get('openai'), baseUrl: s.ai.openaiBaseUrl, model: s.ai.openaiModel, history, persona, ctx, onDelta, signal: chatAbort.signal });
    }
    const m = appendChat({ role: 'assistant', text: full.trim() || '…', source: 'ai', id: replyId });
    send('chat:stream', { id: replyId, done: true, message: m });
    command('chatReply', { text: full.trim() });
    return { ok: true, message: m };
  } catch (e) {
    const msg = explainError(e, st.provider);
    log('chat error', e?.status, e?.message);
    send('chat:stream', { id: replyId, error: msg });
    if (full.trim()) appendChat({ role: 'assistant', text: full.trim(), source: 'ai' });
    appendChat({ role: 'system', text: msg, source: 'error' });
    return { ok: false, error: msg };
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('init', () => ({
    settings: settings.get(),
    story: storyStore.get(),
    character: characterInfo(),
    petState,
    platform: process.platform,
    testMode: TEST,
    windowStatus: tracker.status,
  }));
  ipcMain.on('set-interactive', (e, on) => {
    if (!overlay || e.sender !== overlay.webContents) return;
    overlay.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (e, patch) => applySettings(patch || {}));
  ipcMain.on('story:save', (e, st) => storyStore.replace(st));
  ipcMain.handle('story:reset', () => {
    const fresh = { refusals: 0, ignores: 0, maybes: 0, dealStatus: 'none', episodes: 0, meltdowns: 0, deals: 0, askDealNext: false };
    storyStore.replace(fresh);
    command('resetStory', fresh);
    return fresh;
  });
  ipcMain.on('pet:state', (e, st) => (petState = st));
  ipcMain.on('pet:command', (e, { cmd, data }) => command(cmd, data));
  ipcMain.on('log', (e, msg) => log(msg));

  ipcMain.on('chat:append', (e, m) => appendChat(m));
  ipcMain.on('chat:answered', (e, { handled }) => {
    const r = pendingAnswer;
    pendingAnswer = null;
    r?.(handled);
  });
  ipcMain.handle('chat:history', () => chatStore.get().messages);
  ipcMain.handle('chat:send', (e, text) => handleChatSend(text, e.sender));
  ipcMain.handle('chat:stop', () => chatAbort?.abort());
  ipcMain.handle('chat:clear', () => {
    chatStore.replace({ messages: [] });
    return [];
  });
  ipcMain.handle('chat:collapse', (e, collapsed) => {
    if (!chatWin) return;
    const b = chatWin.getBounds();
    if (collapsed) {
      chatWin.__expanded = b;
      chatWin.__collapsed = true;
      chatWin.setMinimumSize(220, 48);
      chatWin.setBounds({ x: b.x, y: b.y + b.height - 52, width: Math.min(b.width, 300), height: 52 }, true);
    } else {
      chatWin.__collapsed = false;
      const ex = chatWin.__expanded || { ...b, height: 560 };
      chatWin.setMinimumSize(300, 56);
      chatWin.setBounds({ x: b.x, y: Math.max(0, b.y - (ex.height - 52)), width: ex.width, height: ex.height }, true);
    }
  });
  ipcMain.handle('ai:status', () => aiStatus());
  ipcMain.handle('ai:test', async (e) => {
    const st = aiStatus();
    if (!st.configured) return { ok: false, error: 'Not configured yet.' };
    const s = settings.get();
    try {
      let text = '';
      const args = { history: [{ role: 'user', text: 'Say hi in five words or fewer.' }], persona: personaPrompt(s), ctx: {}, onDelta: (d) => (text += d) };
      if (st.provider === 'anthropic') await chatAnthropic({ ...args, apiKey: secrets.get('anthropic'), model: s.ai.anthropicModel, baseURL: process.env.BUDDY_ANTHROPIC_BASE_URL || undefined });
      else await chatOpenAICompatible({ ...args, apiKey: secrets.get('openai'), baseUrl: s.ai.openaiBaseUrl, model: s.ai.openaiModel });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: explainError(err, st.provider) };
    }
  });
  ipcMain.handle('secrets:set', (e, { name, value }) => {
    const r = secrets.set(name, value);
    broadcast('ai-status', aiStatus());
    return { ...r, encryptionAvailable: secrets.encryptionAvailable };
  });
  ipcMain.handle('secrets:clear', (e, name) => {
    secrets.clear(name);
    broadcast('ai-status', aiStatus());
    return true;
  });
  ipcMain.handle('secrets:info', () => ({
    anthropic: secrets.source('anthropic'),
    openai: secrets.source('openai'),
    encryptionAvailable: secrets.encryptionAvailable,
  }));
  ipcMain.handle('status', () => ({
    windows: tracker.status,
    restraintSupported: restraint.supported,
    platform: process.platform,
    character: characterInfo(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));
  ipcMain.on('restraint', (e, { on, x, y }) => {
    if (!settings.get().cursorRestraint) return;
    if (on) {
      const o = overlayOrigin();
      restraint.start({ x: x + o.x, y: y + o.y });
    } else restraint.stop('released');
  });
  ipcMain.on('open', (e, what) => {
    if (what === 'chat') openChat();
    else if (what === 'settings') openSettings();
    else if (what === 'importer') openImporter();
  });
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on('context-menu', (e) => {
    Menu.buildFromTemplate(petMenuTemplate()).popup({ window: BrowserWindow.fromWebContents(e.sender) });
  });
  ipcMain.handle('quit', () => quitApp());
  ipcMain.handle('open-external', (e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  // photo importer
  ipcMain.handle('importer:choose', async () => {
    const r = await dialog.showOpenDialog(importerWin || undefined, {
      title: 'Choose a full-body photo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return readImageAsDataUrl(r.filePaths[0]);
  });
  ipcMain.handle('importer:subject-lift', async (e, filePath) => {
    if (!isMac) return { ok: false, error: 'Automatic subject lifting uses Apple Vision and needs macOS 14 or newer.' };
    const out = path.join(os.tmpdir(), `buddy-lift-${Date.now()}.png`);
    const res = await runProc('/usr/bin/osascript', ['-l', 'JavaScript', path.join(HELPERS, 'mac-subject-lift.js'), filePath, out], 60000);
    if (!fs.existsSync(out)) return { ok: false, error: `macOS couldn't lift the subject (${(res.stderr || '').trim().slice(0, 200) || 'needs macOS 14+'}). Try "Remove Background" in Preview, then import that PNG.` };
    const data = fs.readFileSync(out);
    fs.unlinkSync(out);
    return { ok: true, dataUrl: `data:image/png;base64,${data.toString('base64')}` };
  });
  ipcMain.handle('importer:save', async (e, { rig, parts }) => {
    const dir = userCharDir();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, dataUrl] of Object.entries(parts)) {
      fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    rig.stamp = Date.now();
    fs.writeFileSync(path.join(dir, 'rig.json'), JSON.stringify(rig, null, 2));
    applySettings({ character: 'photo' });
    command('reloadCharacter', characterInfo());
    return { ok: true, dir };
  });
  ipcMain.handle('character:reset', () => {
    fs.rmSync(userCharDir(), { recursive: true, force: true });
    command('reloadCharacter', characterInfo());
    return characterInfo();
  });
  ipcMain.handle('character:bundled-rig', () => {
    const p = path.join(ASSETS, 'character/photo/rig.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  });
}

function readImageAsDataUrl(p) {
  const ext = path.extname(p).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return { path: p, dataUrl: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` };
}

function runProc(cmd, args, timeout) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => p.kill(), timeout);
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: e.message }));
  });
}

// ── test hooks (only with BUDDY_TEST=1) ─────────────────────────────────────
function installTestHooks() {
  globalThis.__buddyTest = {
    setCursor: (p) => (fakeCursor = p),
    setWindows: (list) => tracker.setFake(list),
    state: () => petState,
    overlayBounds: () => overlay?.getBounds(),
    overlayIgnoresMouse: () => overlay?.__ignore,
    command,
    applySettings,
    openChat,
    openSettings,
    quit: quitApp,
    windows: () => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible(), url: w.webContents.getURL() })),
    restraint: () => restraint,
  };
  // record the ignore-mouse state for assertions
  const orig = BrowserWindow.prototype.setIgnoreMouseEvents;
  BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, opts) {
    this.__ignore = ignore;
    return orig.call(this, ignore, opts);
  };
}

// ── lifecycle ───────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const ud = app.getPath('userData');
  settings = new JsonStore(path.join(ud, 'settings.json'), DEFAULT_SETTINGS);
  storyStore = new JsonStore(path.join(ud, 'story.json'), {});
  chatStore = new JsonStore(path.join(ud, 'chat-history.json'), { messages: [] });
  secrets = new Secrets(ud);
  if (TEST) installTestHooks();

  protocol.handle('buddy', (req) => {
    const u = new URL(req.url);
    if (u.host !== 'character') return new Response('not found', { status: 404 });
    const file = path.normalize(path.join(userCharDir(), decodeURIComponent(u.pathname)));
    if (!file.startsWith(userCharDir())) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  tracker = new WindowTracker({
    helperDir: HELPERS,
    ownPid: process.pid,
    onWindows,
    onStatus: (s) => {
      log('windows:', s.reason);
      broadcast('status', { windows: s });
    },
  });
  restraint = new Restraint({ helperDir: HELPERS, onEnded: (reason) => sendOverlay('restraint-ended', { reason }) });

  if (isMac) {
    const dockIcon = iconImage('icon.png');
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    if (!settings.get().showInDock) app.dock.hide();
  }
  registerIpc();
  createOverlay();
  createTray();
  startCursorPolling();
  if (settings.get().useWindows && !TEST) tracker.start();
  else if (!settings.get().useWindows) tracker.setStatus({ available: false, reason: 'Turned off in Settings.' });

  screen.on('display-metrics-changed', fitOverlay);
  screen.on('display-added', fitOverlay);
  screen.on('display-removed', fitOverlay);

  if (!settings.get().welcomed) {
    settings.set({ welcomed: true });
    if (!TEST) setTimeout(openChat, 1500);
  }
  log('ready');
});

app.on('second-instance', () => openChat());
app.on('activate', () => openChat()); // clicking the Dock icon opens the chat
app.on('window-all-closed', () => {
  /* keep running: the pet lives in the overlay + tray */
});
app.on('before-quit', () => {
  quitting = true;
  clearInterval(cursorTimer);
  tracker?.stop();
  restraint?.dispose();
  settings?.saveNow();
  storyStore?.saveNow();
  chatStore?.saveNow();
});
