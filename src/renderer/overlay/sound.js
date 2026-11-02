// All sounds are synthesised with WebAudio — no audio files needed.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.5;
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.master.gain.value = this.volume;
    return this.ctx;
  }

  set(enabled, volume) {
    this.enabled = enabled;
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, gain = 0.3, delay = 0, attack = 0.005 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.15, gain = 0.3, freq = 400, q = 1, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(name) {
    if (!this.enabled || this.volume <= 0) return;
    switch (name) {
      case 'jump':
        return this.tone({ type: 'square', f0: 180, f1: 520, dur: 0.16, gain: 0.08 });
      case 'land':
        return this.noise({ dur: 0.12, gain: 0.35, freq: 260 });
      case 'thud':
        this.noise({ dur: 0.25, gain: 0.6, freq: 180 });
        return this.tone({ type: 'sine', f0: 110, f1: 45, dur: 0.25, gain: 0.3 });
      case 'step':
        return this.noise({ dur: 0.04, gain: 0.08, freq: 900 });
      case 'notice':
        this.tone({ type: 'triangle', f0: 880, f1: 880, dur: 0.08, gain: 0.15 });
        return this.tone({ type: 'triangle', f0: 1320, f1: 1320, dur: 0.12, gain: 0.15, delay: 0.08 });
      case 'grab':
        return this.tone({ type: 'square', f0: 600, f1: 160, dur: 0.1, gain: 0.1 });
      case 'pop':
        return this.tone({ type: 'sine', f0: 400, f1: 900, dur: 0.08, gain: 0.2 });
      case 'celebrate':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, f1: f, dur: 0.14, gain: 0.13, delay: i * 0.09 }));
        return;
      case 'grumble':
        for (let i = 0; i < 4; i++) this.tone({ type: 'sawtooth', f0: 95 + Math.random() * 30, f1: 70, dur: 0.1, gain: 0.07, delay: i * 0.09 });
        return;
      case 'knock':
        this.noise({ dur: 0.05, gain: 0.5, freq: 1200, q: 4 });
        return this.tone({ type: 'sine', f0: 300, f1: 200, dur: 0.06, gain: 0.2 });
      case 'whoosh':
        return this.noise({ dur: 0.3, gain: 0.15, freq: 1500 });
    }
  }

  /** Gibberish voice, one blip per couple of letters (pitch varies with mood). */
  babble(ch, mood = 'normal') {
    if (!this.enabled || this.volume <= 0) return;
    const base = mood === 'furious' ? 150 : mood === 'annoyed' ? 130 : mood === 'dramatic' ? 115 : 105;
    const f = base + ((ch.toLowerCase().charCodeAt(0) * 37) % 60);
    this.tone({ type: mood === 'furious' ? 'sawtooth' : 'triangle', f0: f, f1: f * 0.92, dur: 0.06, gain: mood === 'furious' ? 0.09 : 0.11 });
  }
}
