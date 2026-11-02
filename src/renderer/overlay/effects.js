// Particles and little cartoon symbols: dust, steam, sparkles, confetti, zzz, "!" marks,
// anger veins, sweat drops, dizzy stars, and the "trapped cursor" motion lines.

import { rand, pick, TAU } from '../shared/util.js';

const CONFETTI = ['#e9573f', '#f6bb42', '#3bafda', '#8cc152', '#d770ad', '#40c4b4'];

export class Effects {
  constructor() {
    this.parts = [];
  }

  clear() {
    this.parts.length = 0;
  }

  add(p) {
    this.parts.push({ age: 0, vx: 0, vy: 0, g: 0, rot: 0, vr: 0, size: 6, ...p });
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  dust(x, y, scale, n = 8) {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      this.add({ type: 'dust', x: x + dir * rand(2, 14) * scale, y: y - 2, vx: dir * rand(30, 120) * scale, vy: -rand(10, 50) * scale, life: rand(0.35, 0.6), size: rand(4, 9) * scale });
    }
  }

  steam(x, y, scale) {
    this.add({ type: 'steam', x: x + rand(-6, 6) * scale, y, vx: rand(-20, 20) * scale, vy: -rand(60, 110) * scale, life: rand(0.6, 0.9), size: rand(6, 10) * scale });
  }

  sparkle(x, y, scale, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(60, 180) * scale;
      this.add({ type: 'sparkle', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.8), size: rand(4, 8) * scale, vr: rand(-6, 6) });
    }
  }

  confetti(x, y, scale, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
      const sp = rand(200, 520) * scale;
      this.add({ type: 'confetti', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 700 * scale, life: rand(1.4, 2.4), size: rand(4, 7) * scale, color: pick(CONFETTI), rot: rand(0, TAU), vr: rand(-12, 12) });
    }
  }

  zzz(x, y, scale) {
    this.add({ type: 'text', text: 'z', x, y, vx: rand(10, 25) * scale, vy: -rand(18, 30) * scale, life: 2.2, size: rand(13, 20) * scale, color: '#ffffff', stroke: '#3d4f6b' });
  }

  mark(x, y, scale, text = '!', color = '#ffd84d') {
    this.add({ type: 'mark', text, x, y, life: 0.9, size: 30 * scale, color });
  }

  sweat(x, y, scale) {
    this.add({ type: 'sweat', x, y, vx: rand(-40, 40) * scale, vy: -rand(40, 90) * scale, g: 500 * scale, life: 0.7, size: 5 * scale });
  }

  heart(x, y, scale) {
    this.add({ type: 'text', text: '❤', x, y, vx: rand(-15, 15) * scale, vy: -rand(40, 70) * scale, life: 1.4, size: rand(14, 20) * scale, color: '#ff5b7f' });
  }

  knockLines(x, y, scale) {
    this.add({ type: 'knock', x, y, life: 0.25, size: 12 * scale });
  }

  update(dt) {
    for (const p of this.parts) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.type === 'dust' || p.type === 'steam') {
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 2 * dt;
      }
      if (p.type === 'confetti') p.vx *= 1 - 1.2 * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
  }

  draw(ctx) {
    for (const p of this.parts) {
      const t = p.age / p.life;
      ctx.save();
      switch (p.type) {
        case 'dust':
          ctx.globalAlpha = (1 - t) * 0.55;
          ctx.fillStyle = '#d8cfc0';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + t), 0, TAU);
          ctx.fill();
          break;
        case 'steam':
          ctx.globalAlpha = (1 - t) * 0.85;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.7 + t * 1.2), 0, TAU);
          ctx.fill();
          break;
        case 'sparkle':
          ctx.globalAlpha = 1 - t;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          star(ctx, p.size * (1 - t * 0.5), '#ffe066');
          break;
        case 'confetti':
          ctx.globalAlpha = Math.min(1, (1 - t) * 3);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          break;
        case 'text':
          ctx.globalAlpha = 1 - t;
          ctx.font = `bold ${p.size}px "Avenir Next", "Helvetica Neue", sans-serif`;
          ctx.textAlign = 'center';
          if (p.stroke) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = p.stroke;
            ctx.strokeText(p.text, p.x, p.y);
          }
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
          break;
        case 'mark': {
          const pop = t < 0.15 ? t / 0.15 : 1;
          ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
          ctx.translate(p.x, p.y - pop * 8);
          ctx.scale(pop, pop);
          ctx.font = `900 ${p.size}px "Avenir Next", "Helvetica Neue", sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 5;
          ctx.strokeStyle = '#1b1b1f';
          ctx.strokeText(p.text, 0, 0);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, 0, 0);
          break;
        }
        case 'sweat':
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = '#7fd3ff';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - p.size * 1.4);
          ctx.quadraticCurveTo(p.x + p.size, p.y, p.x, p.y + p.size * 0.6);
          ctx.quadraticCurveTo(p.x - p.size, p.y, p.x, p.y - p.size * 1.4);
          ctx.fill();
          break;
        case 'knock':
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            const a = -Math.PI / 2 + i * 0.6;
            ctx.moveTo(p.x + Math.cos(a) * p.size * 0.6, p.y + Math.sin(a) * p.size * 0.6);
            ctx.lineTo(p.x + Math.cos(a) * p.size * 1.3, p.y + Math.sin(a) * p.size * 1.3);
            ctx.stroke();
          }
          break;
      }
      ctx.restore();
    }
  }

  get bounds() {
    if (!this.parts.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of this.parts) {
      const r = (p.size || 10) * 3;
      x1 = Math.min(x1, p.x - r);
      y1 = Math.min(y1, p.y - r);
      x2 = Math.max(x2, p.x + r);
      y2 = Math.max(y2, p.y + r);
    }
    return { x1, y1, x2, y2 };
  }
}

export function star(ctx, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,60,0,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Anger vein "💢" symbol drawn near his head. */
export function drawVein(ctx, x, y, s, t) {
  const pulse = 1 + 0.15 * Math.sin(t * 14);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * pulse, s * pulse);
  ctx.strokeStyle = '#e8262c';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(2, -7);
    ctx.quadraticCurveTo(2, -2, 7, -2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Dizzy stars orbiting his head. */
export function drawDizzy(ctx, x, y, s, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 4 + (i * TAU) / 3;
    ctx.save();
    ctx.translate(x + Math.cos(a) * 16 * s, y + Math.sin(a) * 5 * s);
    star(ctx, 5 * s, '#ffe066');
    ctx.restore();
  }
}

/** Motion lines around a trapped cursor. */
export function drawTrapped(ctx, x, y, s, t) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + t * 2;
    const r1 = 16 * s + 2 * Math.sin(t * 20 + i);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    ctx.lineTo(x + Math.cos(a) * (r1 + 6 * s), y + Math.sin(a) * (r1 + 6 * s));
    ctx.stroke();
  }
  ctx.restore();
}
