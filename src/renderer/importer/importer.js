import { autoJoints, labelPixels, cutParts, sampleSkin, floodRemoveBackground, buildRig, alphaBounds } from '../shared/segment.js';
import { PhotoCharacter } from '../shared/charPhoto.js';
import { animate } from '../shared/animations.js';
import { fk } from '../shared/rig.js';

const api = window.buddy;
const $ = (id) => document.getElementById(id);
const edit = $('edit'), handles = $('handles'), wrap = $('stageWrap');
const ectx = edit.getContext('2d', { willReadFrequently: true });
const hctx = handles.getContext('2d');
const pv = $('preview');
const pctx = pv.getContext('2d');

let filePath = null;
let orig = null; // canvas with the untouched photo (for the restore brush)
let cut = null; // canvas with background removed
let joints = null;
let view = { s: 1, ox: 0, oy: 0 };
let tool = null;
let dragJoint = null;
let previewChar = null;
let previewAnim = 'idle';
const MAX_H = 1100;

const JOINT_ORDER = ['headTop', 'neck', 'shoulderN', 'elbowN', 'handN', 'shoulderF', 'elbowF', 'handF', 'hip', 'hipN', 'kneeN', 'ankleN', 'hipF', 'kneeF', 'ankleF', 'sole'];
const BONES = [['neck', 'hip'], ['shoulderN', 'elbowN'], ['elbowN', 'handN'], ['shoulderF', 'elbowF'], ['elbowF', 'handF'], ['hipN', 'kneeN'], ['kneeN', 'ankleN'], ['hipF', 'kneeF'], ['kneeF', 'ankleF'], ['shoulderN', 'shoulderF'], ['hipN', 'hipF'], ['headTop', 'neck']];

function msg(t, bad) {
  $('msg').textContent = t;
  $('msg').className = `msg${bad ? ' bad' : ''}`;
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function loadDataUrl(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const s = Math.min(1, MAX_H / img.naturalHeight);
  const c = canvasOf(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function hasTransparency(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 20) n++;
  return n / (d.length / 16) > 0.05;
}

function alphaOf(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const a = new Uint8Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

/** Crop to the subject (plus padding) so the rig coordinates stay tidy. */
function autoCrop() {
  const b = alphaBounds(alphaOf(cut), cut.width, cut.height);
  if (!b) return;
  const pad = 12;
  const x = Math.max(0, b.x1 - pad), y = Math.max(0, b.y1 - pad);
  const w = Math.min(cut.width, b.x2 + pad) - x, h = Math.min(cut.height, b.y2 + pad) - y;
  const crop = (src) => {
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    return c;
  };
  cut = crop(cut);
  orig = crop(orig);
}

function layout() {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  edit.width = handles.width = W;
  edit.height = handles.height = H;
  if (!cut) return;
  const s = Math.min((W - 30) / cut.width, (H - 30) / cut.height);
  view = { s, ox: (W - cut.width * s) / 2, oy: (H - cut.height * s) / 2 };
  redraw();
}

function redraw() {
  ectx.clearRect(0, 0, edit.width, edit.height);
  if (!cut) return;
  ectx.drawImage(cut, view.ox, view.oy, cut.width * view.s, cut.height * view.s);
  drawHandles();
}

const toScreen = (p) => [view.ox + p[0] * view.s, view.oy + p[1] * view.s];
const toImage = (x, y) => [(x - view.ox) / view.s, (y - view.oy) / view.s];

function drawHandles() {
  hctx.clearRect(0, 0, handles.width, handles.height);
  if (!joints) return;
  hctx.lineWidth = 2;
  hctx.strokeStyle = 'rgba(255,255,255,0.7)';
  for (const [a, b] of BONES) {
    const p = toScreen(joints[a]), q = toScreen(joints[b]);
    hctx.beginPath();
    hctx.moveTo(p[0], p[1]);
    hctx.lineTo(q[0], q[1]);
    hctx.stroke();
  }
  // mouth line
  const m = toScreen([joints.headTop[0], joints.mouthY]);
  hctx.strokeStyle = '#ff6fb1';
  hctx.beginPath();
  hctx.moveTo(m[0] - 40, m[1]);
  hctx.lineTo(m[0] + 40, m[1]);
  hctx.stroke();
  for (const k of JOINT_ORDER) {
    const p = toScreen(joints[k]);
    hctx.fillStyle = k.endsWith('N') ? '#3cbfad' : k.endsWith('F') ? '#f2b33d' : '#ffffff';
    hctx.beginPath();
    hctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
    hctx.fill();
    hctx.strokeStyle = '#000';
    hctx.lineWidth = 1.5;
    hctx.stroke();
  }
}

function guessJoints() {
  try {
    joints = autoJoints(alphaOf(cut), cut.width, cut.height);
    msg('Joints guessed — drag the dots to fine-tune, then check the preview.');
  } catch (e) {
    msg(e.message, true);
  }
  redraw();
  rebuildPreview();
}

async function setCut(c, keepOrig) {
  cut = c;
  if (!keepOrig) orig = c;
  autoCrop();
  layout();
  guessJoints();
  $('placeholder').style.display = 'none';
}

$('choose').addEventListener('click', async () => {
  const r = await api.importerChoose();
  if (!r) return;
  filePath = r.path;
  const c = await loadDataUrl(r.dataUrl);
  orig = c;
  cut = canvasOf(c.width, c.height);
  cut.getContext('2d').drawImage(c, 0, 0);
  $('placeholder').style.display = 'none';
  if (hasTransparency(c)) {
    msg('This photo already has a transparent background. 👍');
    await setCut(cut, true);
  } else {
    msg('Now remove the background (step 2).');
    joints = null;
    layout();
  }
});

$('lift').addEventListener('click', async () => {
  if (!filePath) return msg('Choose a photo first.', true);
  msg('Asking macOS to lift him out of the background…');
  const r = await api.importerSubjectLift(filePath);
  if (!r.ok) return msg(r.error, true);
  const c = await loadDataUrl(r.dataUrl);
  await setCut(c);
  msg('Background removed. Clean up with the brush if needed, then line up the joints.');
});

$('flood').addEventListener('click', async () => {
  if (!orig) return msg('Choose a photo first.', true);
  const c = canvasOf(orig.width, orig.height);
  const g = c.getContext('2d');
  g.drawImage(orig, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height);
  floodRemoveBackground(id, parseInt($('tol').value, 10));
  g.putImageData(id, 0, 0);
  cut = c;
  layout();
  guessJoints();
  msg('Flood fill done. Works best on plain backgrounds — use the brush to fix leftovers.');
});

for (const id of ['erase', 'restore']) {
  $(id).addEventListener('click', () => {
    tool = tool === id ? null : id;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.id === tool));
    handles.style.cursor = tool ? 'cell' : 'crosshair';
  });
}

function brushAt(x, y) {
  const [ix, iy] = toImage(x, y);
  const r = parseInt($('brush').value, 10) / view.s / 2;
  const g = cut.getContext('2d');
  g.save();
  g.beginPath();
  g.arc(ix, iy, r, 0, Math.PI * 2);
  g.clip();
  if (tool === 'erase') g.clearRect(ix - r, iy - r, r * 2, r * 2);
  else g.drawImage(orig, 0, 0);
  g.restore();
  redraw();
}

handles.addEventListener('mousedown', (e) => {
  const x = e.offsetX, y = e.offsetY;
  if (tool && cut) {
    dragJoint = '__brush';
    brushAt(x, y);
    return;
  }
  if (!joints) return;
  let best = null, bd = 14;
  for (const k of [...JOINT_ORDER, 'mouthY']) {
    const p = k === 'mouthY' ? toScreen([joints.headTop[0], joints.mouthY]) : toScreen(joints[k]);
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  dragJoint = best;
});
window.addEventListener('mousemove', (e) => {
  if (!dragJoint) return;
  const r = handles.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (dragJoint === '__brush') return brushAt(x, y);
  const p = toImage(x, y);
  if (dragJoint === 'mouthY') joints.mouthY = p[1];
  else joints[dragJoint] = p;
  drawHandles();
});
window.addEventListener('mouseup', () => {
  if (dragJoint) rebuildPreview();
  dragJoint = null;
});
$('autoJoints').addEventListener('click', guessJoints);
$('hideN').addEventListener('change', rebuildPreview);
$('hideF').addEventListener('change', rebuildPreview);

function makeParts() {
  const g = cut.getContext('2d');
  const id = g.getImageData(0, 0, cut.width, cut.height);
  const alpha = alphaOf(cut);
  const labels = labelPixels(alpha, cut.width, cut.height, joints);
  const parts = cutParts(id, labels, canvasOf, 3);
  const rig = buildRig(joints, parts, sampleSkin(id, joints));
  rig.handVisible = { N: !$('hideN').checked, F: !$('hideF').checked };
  return { rig, parts };
}

let rebuildTimer = null;
function rebuildPreview() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    if (!cut || !joints) return;
    const { rig, parts } = makeParts();
    const images = Object.fromEntries(Object.entries(parts).map(([n, p]) => [n, p.canvas]));
    previewChar = new PhotoCharacter(rig, images, { headScale: 1.2 });
  }, 150);
}

document.querySelectorAll('.pv-buttons button').forEach((b) => b.addEventListener('click', () => (previewAnim = b.dataset.anim)));

let t0 = performance.now();
function previewLoop(now) {
  requestAnimationFrame(previewLoop);
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.clearRect(0, 0, pv.width, pv.height);
  if (!previewChar) return;
  const t = (now - t0) / 1000;
  const pose = animate(previewAnim, t % 4, { phase: t * 7, skel: previewChar.skel, target: [32, -78], time: t, talking: previewAnim === 'talk' });
  previewChar.adjustPose(pose, previewAnim);
  const J = fk(pose, previewChar.skel);
  pctx.translate(pv.width / 2, pv.height * 0.7 + (pose.grounded ? 0 : -30));
  const k = 2.6;
  pctx.scale(k, k);
  pctx.scale(pose.sx, pose.sy);
  previewChar.draw(pctx, pose, J);
}
requestAnimationFrame(previewLoop);

$('save').addEventListener('click', async () => {
  if (!cut || !joints) return msg('Choose a photo and remove the background first.', true);
  const { rig, parts } = makeParts();
  const payload = { rig, parts: Object.fromEntries(Object.entries(parts).map(([n, p]) => [n, p.canvas.toDataURL('image/png')])) };
  const r = await api.importerSave(payload);
  msg(r.ok ? 'Saved! He now looks like your photo. You can close this window.' : 'Saving failed.', !r.ok);
});
$('useCartoon').addEventListener('click', () => api.setSettings({ character: 'cartoon' }).then(() => msg('Switched to the drawn cartoon.')));
$('resetImport').addEventListener('click', async () => {
  await api.characterReset();
  msg('Imported photo removed (the built-in character is used again).');
});

window.addEventListener('resize', layout);
layout();
window.__importer = { get joints() { return joints; }, set joints(j) { joints = j; redraw(); rebuildPreview(); }, setCut, loadDataUrl, makeParts };
