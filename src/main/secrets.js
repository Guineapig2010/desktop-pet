// API keys are encrypted with the operating system's credential store (macOS Keychain via
// Electron safeStorage) before they touch the disk. They are never written in plain text and
// never sent to any renderer window.
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

export class Secrets {
  constructor(dir) {
    this.file = path.join(dir, 'secrets.json');
    this.memory = {}; // fallback when OS encryption is unavailable (kept for this session only)
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* none yet */
    }
  }
  get encryptionAvailable() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }
  envKey(name) {
    return name === 'anthropic' ? process.env.ANTHROPIC_API_KEY : name === 'openai' ? process.env.OPENAI_API_KEY : undefined;
  }
  get(name) {
    if (this.memory[name]) return this.memory[name];
    const enc = this.data[name];
    if (enc && this.encryptionAvailable) {
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch {
        /* key from another machine/user */
      }
    }
    return this.envKey(name) || null;
  }
  has(name) {
    return !!this.get(name);
  }
  source(name) {
    if (this.memory[name]) return 'session';
    if (this.data[name] && this.encryptionAvailable) return 'keychain';
    if (this.envKey(name)) return 'environment';
    return null;
  }
  set(name, value) {
    value = String(value || '').trim();
    if (!value) return this.clear(name);
    if (this.encryptionAvailable) {
      this.data[name] = safeStorage.encryptString(value).toString('base64');
      delete this.memory[name];
      this.save();
      return { stored: 'keychain' };
    }
    this.memory[name] = value;
    return { stored: 'session' };
  }
  clear(name) {
    delete this.data[name];
    delete this.memory[name];
    this.save();
    return { stored: null };
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}
