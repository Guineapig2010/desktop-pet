// Tiny JSON file stores in the app's user-data folder.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = deepMerge(structuredClone(defaults), raw);
    } catch {
      /* first run or unreadable: defaults */
    }
    this.timer = null;
  }
  get() {
    return this.data;
  }
  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.saveSoon();
    return this.data;
  }
  replace(data) {
    this.data = data;
    this.saveSoon();
  }
  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 250);
  }
  saveNow() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('save failed', this.file, e.message);
    }
  }
}

export function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export const DEFAULT_SETTINGS = {
  size: 1,
  headScale: 1.2,
  speed: 1,
  chaseFrequency: 0.5,
  dialogueFrequency: 0.5,
  sound: true,
  volume: 0.5,
  paused: false,
  useWindows: true,
  cursorRestraint: false,
  lowPower: false,
  showInDock: true,
  hidden: false,
  displayId: null,
  userName: 'pal',
  petName: 'General Fok',
  character: 'photo', // 'photo' (if available) or 'cartoon'
  ai: {
    provider: 'none', // none | anthropic | openai
    anthropicModel: 'claude-opus-5-5',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: '',
  },
};
