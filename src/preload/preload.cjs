// Safe bridge between the renderer windows and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('buddy', {
  // overlay
  getInit: () => ipcRenderer.invoke('init'),
  setInteractive: (on) => ipcRenderer.send('set-interactive', on),
  onCursor: on('cursor'),
  onWindows: on('windows'),
  onCommand: on('command'),
  onRestraintEnded: on('restraint-ended'),
  restraint: (on, x, y) => ipcRenderer.send('restraint', { on, x, y }),
  saveStory: (state) => ipcRenderer.send('story:save', state),
  reportState: (st) => ipcRenderer.send('pet:state', st),
  showContextMenu: () => ipcRenderer.send('context-menu'),
  chatAppend: (m) => ipcRenderer.send('chat:append', m),
  chatAnswered: (r) => ipcRenderer.send('chat:answered', r),
  log: (msg) => ipcRenderer.send('log', String(msg)),

  // shared
  onSettings: on('settings'),
  onStatus: on('status'),
  onAiStatus: on('ai-status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  status: () => ipcRenderer.invoke('status'),
  petCommand: (cmd, data) => ipcRenderer.send('pet:command', { cmd, data }),
  openChat: () => ipcRenderer.send('open', 'chat'),
  openSettings: () => ipcRenderer.send('open', 'settings'),
  openImporter: () => ipcRenderer.send('open', 'importer'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  closeWindow: () => ipcRenderer.send('window:close'),
  quit: () => ipcRenderer.invoke('quit'),
  resetStory: () => ipcRenderer.invoke('story:reset'),

  // chat
  chatHistory: () => ipcRenderer.invoke('chat:history'),
  chatSend: (text) => ipcRenderer.invoke('chat:send', text),
  chatStop: () => ipcRenderer.invoke('chat:stop'),
  chatClear: () => ipcRenderer.invoke('chat:clear'),
  chatCollapse: (c) => ipcRenderer.invoke('chat:collapse', c),
  onChatMessage: on('chat:message'),
  onChatStream: on('chat:stream'),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiTest: () => ipcRenderer.invoke('ai:test'),
  setSecret: (name, value) => ipcRenderer.invoke('secrets:set', { name, value }),
  clearSecret: (name) => ipcRenderer.invoke('secrets:clear', name),
  secretInfo: () => ipcRenderer.invoke('secrets:info'),

  // photo importer
  importerChoose: () => ipcRenderer.invoke('importer:choose'),
  importerSubjectLift: (p) => ipcRenderer.invoke('importer:subject-lift', p),
  importerSave: (payload) => ipcRenderer.invoke('importer:save', payload),
  characterReset: () => ipcRenderer.invoke('character:reset'),
  bundledRig: () => ipcRenderer.invoke('character:bundled-rig'),
});
