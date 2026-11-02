// Doe — a boxy little robot on tank treads with a screen for a face. General Fok's favourite
// (and most reluctant) business partner. Drawn in units: 100 units = Doe's full height.
// Origin is between the treads, +x is the direction Doe faces.

const C = {
  outline: '#0d1218',
  metal: '#b9c6d3',
  metalDark: '#8394a6',
  metalHi: '#e2eaf2',
  panel: '#3fb6a8',
  panelDark: '#2a8a7f',
  screen: '#122030',
  glow: '#5ff2e8',
  glowWarm: '#ffd34d',
  glowAngry: '#ff5a4f',
  tread: '#2b3138',
  treadHi: '#4a535d',
};

export class RobotCharacter {
  /**
   * @param ctx canvas context, already translated/scaled so 1 unit = Doe's height / 100
   * @param s   state: { face, talk (0..1), treadPhase, armN, armF ([shoulder, elbow]), lean, antennaOn, time, bob }
   */
  draw(ctx, s) {
    const t = s.time || 0;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.arm(ctx, s.armF || [0.2, 0.3], [-17, -50], true);
    this.treads(ctx, s.treadPhase || 0);
    ctx.save();
    ctx.translate(0, -14);
    ctx.rotate(s.lean || 0);
    ctx.translate(0, 14 + (s.bob || 0));
    this.body(ctx, s);
    this.head(ctx, s, t);
    ctx.restore();
    this.arm(ctx, s.armN || [0.2, 0.3], [17, -50 + (s.bob || 0)], false);
    ctx.restore();
  }

  treads(ctx, phase) {
    ctx.fillStyle = C.tread;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-23, -15, 46, 15, 7);
    ctx.fill();
    ctx.stroke();
    // moving tread teeth
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-23, -15, 46, 15, 7);
    ctx.clip();
    ctx.strokeStyle = C.treadHi;
    ctx.lineWidth = 1.4;
    const off = ((phase * 6) % 6 + 6) % 6;
    for (let x = -30 + off; x < 30; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, -15);
      ctx.lineTo(x, -12.5);
      ctx.moveTo(x, -2.5);
      ctx.lineTo(x, 0);
      ctx.stroke();
    }
    ctx.restore();
    for (const x of [-14, 0, 14]) {
      ctx.fillStyle = C.metalDark;
      ctx.beginPath();
      ctx.arc(x, -7.5, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(x, -7.5);
      ctx.rotate(phase * 1.3);
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(3, 0);
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  body(ctx, s) {
    // neck
    ctx.fillStyle = C.metalDark;
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 1.4;
    ctx.fillRect(-4, -66, 8, 9);
    ctx.strokeRect(-4, -66, 8, 9);
    // torso
    const g = ctx.createLinearGradient(-18, -58, 18, -14);
    g.addColorStop(0, C.metalHi);
    g.addColorStop(0.5, C.metal);
    g.addColorStop(1, C.metalDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-19, -59, 38, 46, 7);
    ctx.fill();
    ctx.stroke();
    // chest panel with name
    ctx.fillStyle = C.panel;
    ctx.beginPath();
    ctx.roundRect(-12, -52, 24, 17, 3);
    ctx.fill();
    ctx.strokeStyle = C.panelDark;
    ctx.stroke();
    ctx.fillStyle = '#eafffb';
    ctx.font = 'bold 9px "Menlo", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    if (s.flip < 0) ctx.scale(-1, 1); // keep the label readable when Doe faces left
    ctx.fillText('DOE', 0, -43.2);
    ctx.restore();
    // indicator lights
    const lights = ['#ff5a4f', '#ffd34d', '#5ff27a'];
    lights.forEach((c, i) => {
      const on = Math.floor((s.time || 0) * 3 + i) % 3 === 0;
      ctx.fillStyle = on ? c : '#35404b';
      ctx.beginPath();
      ctx.arc(-8 + i * 8, -27, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    // rivets
    ctx.fillStyle = C.metalDark;
    for (const [x, y] of [[-15, -55], [15, -55], [-15, -18], [15, -18]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  head(ctx, s, t) {
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 1.6;
    // antenna
    ctx.beginPath();
    ctx.moveTo(0, -97);
    ctx.lineTo(0, -106);
    ctx.stroke();
    const blink = s.antennaOn ?? Math.sin(t * 5) > 0;
    ctx.fillStyle = blink ? (s.face === 'angry' ? C.glowAngry : '#7dff8a') : '#3a4a3c';
    ctx.beginPath();
    ctx.arc(0, -108, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // ears
    ctx.fillStyle = C.metalDark;
    ctx.beginPath();
    ctx.roundRect(-27, -88, 5, 14, 2);
    ctx.roundRect(22, -88, 5, 14, 2);
    ctx.fill();
    ctx.stroke();
    // head shell
    const g = ctx.createLinearGradient(-23, -98, 23, -64);
    g.addColorStop(0, C.metalHi);
    g.addColorStop(1, C.metal);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-23, -98, 46, 34, 8);
    ctx.fill();
    ctx.stroke();
    // screen face
    ctx.fillStyle = C.screen;
    ctx.beginPath();
    ctx.roundRect(-18, -94, 36, 26, 5);
    ctx.fill();
    // a slight 3/4 turn: the face shifts towards where Doe looks
    ctx.save();
    ctx.translate(2.5, 0);
    this.face(ctx, s, t);
    ctx.restore();
    // glare
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -90);
    ctx.lineTo(-8, -90);
    ctx.stroke();
  }

  face(ctx, s, t) {
    const face = s.face || 'normal';
    const col = face === 'angry' ? C.glowAngry : face === 'dollar' ? C.glowWarm : C.glow;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = col;
    ctx.shadowBlur = 4;
    const eyes = [-7, 7];
    const ey = -84;
    switch (face) {
      case 'happy':
        for (const x of eyes) {
          ctx.beginPath();
          ctx.arc(x, ey + 2, 3.4, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
        }
        break;
      case 'dollar':
        ctx.font = 'bold 11px "Menlo", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const x of eyes) ctx.fillText('$', x, ey + 0.5);
        break;
      case 'angry':
        for (const [i, x] of eyes.entries()) {
          ctx.beginPath();
          const d = i === 0 ? 1 : -1;
          ctx.moveTo(x - 4, ey - 2 * d);
          ctx.lineTo(x + 4, ey + 2 * d);
          ctx.stroke();
        }
        break;
      case 'x':
        for (const x of eyes) {
          ctx.beginPath();
          ctx.moveTo(x - 3, ey - 3);
          ctx.lineTo(x + 3, ey + 3);
          ctx.moveTo(x + 3, ey - 3);
          ctx.lineTo(x - 3, ey + 3);
          ctx.stroke();
        }
        break;
      case 'loading': {
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = Math.floor(t * 4) % 3 === i ? 1 : 0.3;
          ctx.beginPath();
          ctx.arc(-6 + i * 6, ey, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'heart':
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const x of eyes) ctx.fillText('♥', x, ey);
        break;
      case 'blink':
        for (const x of eyes) {
          ctx.beginPath();
          ctx.moveTo(x - 3.5, ey);
          ctx.lineTo(x + 3.5, ey);
          ctx.stroke();
        }
        break;
      default:
        for (const x of eyes) {
          ctx.beginPath();
          ctx.roundRect(x - 2.6, ey - 4, 5.2, 8, 2.6);
          ctx.fill();
        }
    }
    // mouth: a waveform while talking, a flat line otherwise
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const talk = s.talk || 0;
    for (let x = -9; x <= 9; x += 1) {
      const y = -74.5 + (talk > 0.05 ? Math.sin(x * 1.3 + t * 30) * 2.4 * talk : face === 'angry' ? Math.abs(x) * 0.15 : face === 'happy' || face === 'heart' || face === 'dollar' ? -Math.cos(x / 6) * 1.6 + 1 : 0);
      x === -9 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  arm(ctx, [a1, a2], sh, far) {
    const L1 = 14, L2 = 12;
    const e = [sh[0] + Math.sin(a1) * L1, sh[1] + Math.cos(a1) * L1];
    const h = [e[0] + Math.sin(a1 + a2) * L2, e[1] + Math.cos(a1 + a2) * L2];
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(sh[0], sh[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.lineTo(h[0], h[1]);
    ctx.stroke();
    ctx.strokeStyle = far ? C.metalDark : C.metal;
    ctx.lineWidth = 4.2;
    ctx.stroke();
    // elbow joint
    ctx.fillStyle = C.metalDark;
    ctx.beginPath();
    ctx.arc(e[0], e[1], 2.6, 0, Math.PI * 2);
    ctx.fill();
    // claw
    const ang = Math.atan2(h[1] - e[1], h[0] - e[0]);
    ctx.save();
    ctx.translate(h[0], h[1]);
    ctx.rotate(ang);
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(5, -4, 7, -1);
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(5, 4, 7, 1);
    ctx.stroke();
    ctx.restore();
    return h;
  }

  /** Hand position for a given arm (character units, unflipped). */
  handPos([a1, a2], near = true, bob = 0) {
    const sh = near ? [17, -50 + bob] : [-17, -50];
    const e = [sh[0] + Math.sin(a1) * 14, sh[1] + Math.cos(a1) * 14];
    return [e[0] + Math.sin(a1 + a2) * 12, e[1] + Math.cos(a1 + a2) * 12];
  }
}
