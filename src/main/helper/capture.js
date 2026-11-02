// Screenshots of the ONE display or window the user picked, using the OS-supported capture API
// (Electron desktopCapturer → ScreenCaptureKit / CGWindow on macOS, which needs the
// "Screen & System Audio Recording" permission). Includes the mapping between screenshot pixels
// and global screen points, so clicks land exactly where the model pointed, at any display scale.
import { desktopCapturer, screen } from 'electron';

export const MODEL_BOX = { w: 1400, h: 900 }; // screenshots sent to the model fit inside this (well under API limits)

export async function listSources() {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
  const displays = screen.getAllDisplays();
  return sources
    .filter((s) => !/Albuquerque Buddy|General Fok can see/i.test(s.name))
    .map((s, i) => {
      const kind = s.id.startsWith('screen:') ? 'screen' : 'window';
      const d = kind === 'screen' ? displays.find((x) => String(x.id) === String(s.display_id)) || displays[i] || displays[0] : null;
      return {
        id: s.id,
        kind,
        name: kind === 'screen' ? (displays.length > 1 ? `Display ${displays.indexOf(d) + 1}${d === screen.getPrimaryDisplay() ? ' (main)' : ''}` : 'Entire screen') : s.name,
        displayId: d ? d.id : null,
        thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      };
    });
}

/**
 * Capture the chosen source.
 * @param src { id, kind, displayId, name }
 * @param windowBounds (id) → {x,y,w,h} | null   — bounds in global points for window sources
 */
export async function capture(src, windowBounds) {
  let thumb, origin, ptsPerPx, display;
  if (src.kind === 'screen') {
    display = screen.getAllDisplays().find((d) => d.id === src.displayId) || screen.getPrimaryDisplay();
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const s = list.find((x) => x.id === src.id) || list.find((x) => String(x.display_id) === String(display.id)) || list[0];
    if (!s) throw new Error('That display is no longer available.');
    thumb = s.thumbnail;
    const sz = thumb.getSize();
    origin = { x: display.bounds.x, y: display.bounds.y };
    ptsPerPx = display.bounds.width / sz.width;
  } else {
    const b = windowBounds(src.id);
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 3840, height: 2400 } });
    const s = list.find((x) => x.id === src.id);
    if (!s) throw new Error('That window is closed or hidden. Choose what to share again.');
    if (!b) throw new Error("Can't locate that window on screen right now.");
    thumb = s.thumbnail;
    const sz = thumb.getSize();
    origin = { x: b.x, y: b.y };
    ptsPerPx = b.w / sz.width;
    display = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.w, height: b.h });
  }
  if (thumb.isEmpty()) {
    const e = new Error('The screenshot came back empty. On macOS, allow Screen Recording for this app, then restart it.');
    e.code = 'screen';
    throw e;
  }
  const full = thumb.getSize();
  const scale = Math.min(1, MODEL_BOX.w / full.width, MODEL_BOX.h / full.height);
  const mw = Math.round(full.width * scale), mh = Math.round(full.height * scale);
  const modelImg = scale < 1 ? thumb.resize({ width: mw, height: mh, quality: 'best' }) : thumb;
  return {
    src,
    image: thumb,
    full,
    model: { w: mw, h: mh, scale, b64: modelImg.toPNG().toString('base64') },
    origin,
    ptsPerPx,
    displayId: display?.id,
    at: Date.now(),
  };
}

/** Model-space coordinate → global screen point. */
export function toGlobal(shot, [mx, my]) {
  const fx = mx / shot.model.scale, fy = my / shot.model.scale;
  return { x: shot.origin.x + fx * shot.ptsPerPx, y: shot.origin.y + fy * shot.ptsPerPx };
}

/** Global screen point → model-space coordinate. */
export function fromGlobal(shot, p) {
  return [Math.round(((p.x - shot.origin.x) / shot.ptsPerPx) * shot.model.scale), Math.round(((p.y - shot.origin.y) / shot.ptsPerPx) * shot.model.scale)];
}

export function inShot(shot, [mx, my]) {
  return mx >= 0 && my >= 0 && mx <= shot.model.w && my <= shot.model.h;
}

/** A closer look: crop a model-space region at full resolution and fit it to the model box. */
export function zoom(shot, [x0, y0, x1, y1]) {
  const s = shot.model.scale;
  const rx = Math.max(0, Math.floor(Math.min(x0, x1) / s)), ry = Math.max(0, Math.floor(Math.min(y0, y1) / s));
  const rw = Math.max(8, Math.min(shot.full.width - rx, Math.ceil(Math.abs(x1 - x0) / s)));
  const rh = Math.max(8, Math.min(shot.full.height - ry, Math.ceil(Math.abs(y1 - y0) / s)));
  const crop = shot.image.crop({ x: rx, y: ry, width: rw, height: rh });
  const k = Math.min(MODEL_BOX.w / rw, MODEL_BOX.h / rh, 4);
  const out = crop.resize({ width: Math.max(1, Math.round(rw * k)), height: Math.max(1, Math.round(rh * k)), quality: 'best' });
  return out.toPNG().toString('base64');
}

/** Tiny grayscale fingerprint of the area around a global point (to notice if things moved). */
export function signature(shot, p, radiusPts = 24) {
  const cx = (p.x - shot.origin.x) / shot.ptsPerPx, cy = (p.y - shot.origin.y) / shot.ptsPerPx;
  const r = radiusPts / shot.ptsPerPx;
  const x = Math.round(cx - r), y = Math.round(cy - r), w = Math.round(2 * r), h = Math.round(2 * r);
  if (x < 0 || y < 0 || x + w > shot.full.width || y + h > shot.full.height) return null;
  const small = shot.image.crop({ x, y, width: w, height: h }).resize({ width: 16, height: 16 });
  const bmp = small.toBitmap(); // BGRA
  const g = new Float32Array(256);
  for (let i = 0; i < 256; i++) g[i] = (bmp[i * 4] + bmp[i * 4 + 1] + bmp[i * 4 + 2]) / 3;
  return g;
}

export function signatureDiff(a, b) {
  if (!a || !b) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length; // mean abs difference, 0..255
}
