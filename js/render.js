// 畫面：紙張、地形、士兵、特效（全部用程式畫，不需要圖檔）
import { GW, GH, F, FLOOR } from './terrain.js';
import { UNITS } from './units.js';

export const TEAM = [
  { ink: '#1f4fbf', fill: '#cfdcfb', name: '藍隊' },
  { ink: '#c2372a', fill: '#f9d3cc', name: '紅隊' },
];
const SC = 4; // 地形圖層：每格幾個像素

/* ---------------- 紙張 ---------------- */

export function drawPaper(ctx, w, h) {
  ctx.fillStyle = '#f6f1e4';
  ctx.fillRect(0, 0, w, h);
  const step = w / 30;
  ctx.strokeStyle = 'rgba(90,130,190,0.13)';
  ctx.lineWidth = Math.max(1, w / 900);
  ctx.beginPath();
  for (let x = step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

/* ---------------- 地形圖層 ---------------- */

function blurMask(src, w, h, pass) {
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  for (let p = 0; p < pass; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { s += yy >= h ? 1 : 0; n++; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            s += a[yy * w + xx]; n++;
          }
        }
        b[y * w + x] = s / n;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

function sampler(field, w, h) {
  return (fx, fy) => {
    const x = Math.min(w - 1.001, Math.max(0, fx)), y = Math.min(h - 1.001, Math.max(0, fy));
    const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
    const i = y0 * w + x0;
    const a = field[i], b = field[i + 1], c = field[i + w], d = field[i + w + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// 小亂數（固定）
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fields(T) {
  const N = GW * GH;
  const solidF = new Float32Array(N), waterF = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    solidF[i] = T.solid[i];
    waterF[i] = T.flag[i] & F.WATER ? 1 : 0;
  }
  return { sv: sampler(blurMask(solidF, GW, GH, 2), GW, GH), wv: sampler(blurMask(waterF, GW, GH, 1), GW, GH) };
}

export function buildTerrainLayer(T, opts = {}) {
  const BW = GW * SC, BH = GH * SC;
  const c = document.createElement('canvas');
  c.width = BW; c.height = BH;
  const ctx = c.getContext('2d');
  drawPaper(ctx, BW, BH);
  if (!T) return c;
  paintRegion(T, ctx, { x0: 0, y0: 0, x1: GW, y1: GH }, !!opts.ghost, true);
  return c;
}

// 重畫地形圖層的一個範圍（格子座標）；炸出坑洞時只重畫那一塊
export function paintRegion(T, ctx, r, ghost, fresh) {
  const BW = GW * SC, BH = GH * SC;
  const { sv, wv } = fields(T);
  const gx0 = Math.max(0, Math.floor(r.x0)), gy0 = Math.max(0, Math.floor(r.y0));
  const gx1 = Math.min(GW, Math.ceil(r.x1)), gy1 = Math.min(GH, Math.ceil(r.y1));
  const X0 = gx0 * SC, Y0 = gy0 * SC, RW = (gx1 - gx0) * SC, RH = (gy1 - gy0) * SC;
  if (RW <= 0 || RH <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(X0, Y0, RW, RH); ctx.clip();
  if (!fresh) drawPaper(ctx, BW, BH);

  const img = ctx.getImageData(X0, Y0, RW, RH);
  const px = img.data;
  const O = 3; // 外框粗細
  // 範圍外多算 O 像素，外框才接得起來
  const IW = RW + 2 * O, IH = RH + 2 * O;
  const inside = new Uint8Array(IW * IH);
  for (let y = 0; y < IH; y++) {
    const fy = (Y0 - O + y + 0.5) / SC - 0.5;
    for (let x = 0; x < IW; x++) inside[y * IW + x] = sv((X0 - O + x + 0.5) / SC - 0.5, fy) > 0.5 ? 1 : 0;
  }
  const at = (x, y) => inside[(y + O) * IW + x + O];
  const floorY = (GH - FLOOR) * SC;
  for (let y = 0; y < RH; y++) {
    const Y = Y0 + y;
    for (let x = 0; x < RW; x++) {
      const X = X0 + x;
      const j = (y * RW + x) * 4;
      if (at(x, y)) {
        const edge = !at(x, y - O) || !at(x, y + O) || !at(x - O, y) || !at(x + O, y);
        let cr, cg, cb;
        if (edge && Y < floorY + 2) { cr = 44; cg = 40; cb = 46; }
        else if (Y >= floorY) {
          // 桌面：木紋
          const grain = Math.sin(Y * 0.9 + Math.sin(X * 0.013) * 4) * 0.5 + 0.5;
          cr = 176 - grain * 18; cg = 128 - grain * 14; cb = 86 - grain * 10;
        } else {
          // 鉛筆斜線陰影
          const hatch = ((X + Y) % 10) < 1.6 ? 1 : 0;
          const n = hash(X >> 3, Y >> 3) * 10;
          cr = 208 - hatch * 46 - n; cg = 199 - hatch * 46 - n; cb = 178 - hatch * 42 - n;
        }
        if (ghost) { // 佈陣時淡淡顯示上一張地形
          const a = 0.28;
          px[j] = px[j] * (1 - a) + cr * a; px[j + 1] = px[j + 1] * (1 - a) + cg * a; px[j + 2] = px[j + 2] * (1 - a) + cb * a;
        } else { px[j] = cr; px[j + 1] = cg; px[j + 2] = cb; }
      } else if (!ghost) {
        const fx = (X + 0.5) / SC - 0.5;
        const w = wv(fx, (Y + 0.5) / SC - 0.5);
        if (w > 0.45) {
          const top = wv(fx, (Y - 3.5) / SC - 0.5) <= 0.45;
          const a = top ? 0.9 : 0.55;
          const wr = top ? 120 : 92, wg = top ? 185 : 160, wb = top ? 240 : 225;
          px[j] = px[j] * (1 - a) + wr * a; px[j + 1] = px[j + 1] * (1 - a) + wg * a; px[j + 2] = px[j + 2] * (1 - a) + wb * a;
        }
      }
    }
  }
  ctx.putImageData(img, X0, Y0);
  if (ghost) { ctx.restore(); return; }

  ctx.scale(SC, SC);
  const cx0 = Math.max(0, gx0 - 3), cx1 = Math.min(GW, gx1 + 3), cy0 = Math.max(0, gy0 - 3), cy1 = Math.min(GH, gy1 + 3);
  // 圓滑面：金色小點
  ctx.fillStyle = 'rgba(226,160,30,0.85)';
  for (let y = cy0; y < Math.min(cy1, GH - FLOOR); y++) for (let x = cx0; x < cx1; x++) {
    const f = T.flag[y * GW + x];
    if ((f & F.ROUND) && !(f & F.MOSS) && (x + y) % 3 === 0) {
      ctx.beginPath(); ctx.arc(x + 0.5, y + 0.2, 0.6, 0, 7); ctx.fill();
    }
  }
  // 青苔
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    if (!(T.flag[y * GW + x] & F.MOSS)) continue;
    const k = hash(x, y);
    ctx.fillStyle = k < 0.33 ? '#4d8f32' : k < 0.66 ? '#69a944' : '#86c05a';
    ctx.beginPath(); ctx.arc(x + 0.5, y + 0.1 - k * 0.6, 1.1 + k * 0.7, 0, 7); ctx.fill();
    if (k > 0.85) { // 小花
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath(); ctx.arc(x + 0.5, y - 1.2, 0.5, 0, 7); ctx.fill();
    }
  }
  // 尖刺：沿著法線長出小刺
  ctx.fillStyle = '#7a1d1d';
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    if (!(T.flag[y * GW + x] & F.THORN) || (x + y) % 2) continue;
    let nx = sv(x - 1, y) - sv(x + 1, y), ny = sv(x, y - 1) - sv(x, y + 1);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (ny > 0.3) continue;
    const bx = x + 0.5 + nx * 0.5, by = y + 0.5 + ny * 0.5;
    const len = 2.2 + hash(x, y) * 1.2;
    ctx.beginPath();
    ctx.moveTo(bx - ny * 0.8, by + nx * 0.8);
    ctx.lineTo(bx + nx * len, by + ny * len);
    ctx.lineTo(bx + ny * 0.8, by - nx * 0.8);
    ctx.closePath(); ctx.fill();
  }
  const near = (x, y, m) => x >= cx0 - m && x <= cx1 + m && y >= cy0 - m && y <= cy1 + m;
  for (const s of T.features.spikes) {
    if (!near(s.x, s.y, 6) || !(T.flagAt(s.x, s.y) & F.THORN)) continue;
    ctx.fillStyle = '#9c2222';
    ctx.strokeStyle = '#3a0c0c';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(s.x - 1.4, s.y + 1.5); ctx.lineTo(s.x + 0.5, s.y - 4.5); ctx.lineTo(s.x + 2.4, s.y + 1.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // 蘑菇（還在的才畫）
  for (const m of T.features.mushrooms) {
    if (!near(m.cx, m.cy, 12) || !(T.flagAt(m.cx, m.cy) & F.MUSH)) continue;
    const cw = Math.max(7, m.w + 4), ch = Math.max(4, m.h * 0.6 + 2);
    const top = m.y - 1.5;
    ctx.fillStyle = '#efe2c4'; ctx.strokeStyle = '#3b2a20'; ctx.lineWidth = 0.5;
    ctx.fillRect(m.cx - 1.4, top + ch * 0.8, 2.8, m.y + m.h - top - ch * 0.8);
    ctx.strokeRect(m.cx - 1.4, top + ch * 0.8, 2.8, m.y + m.h - top - ch * 0.8);
    ctx.fillStyle = '#d8342a';
    ctx.beginPath(); ctx.ellipse(m.cx, top + ch, cw / 2, ch, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const [dx, dy] of [[-0.25, 0.45], [0.2, 0.25], [0.05, 0.7]]) {
      ctx.beginPath(); ctx.arc(m.cx + dx * cw, top + ch - dy * ch, 0.7, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------------- 士兵 ---------------- */

function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function circ(ctx, x, y, r, fill = true) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); if (fill) ctx.fill(); ctx.stroke(); }

// 在格子座標中畫一個兵；(0,0) 是腳底中心，往上是負
export function drawUnit(ctx, u, team, t) {
  const c = TEAM[team];
  const hit = u.hitT > 0;
  const fill = hit ? '#ffffff' : c.fill;
  const walking = u.state === 'walk';
  const ph = walking ? Math.sin((u.anim ?? t) * 13) : 0;
  const swing = (u.swing || 0) > 0;
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.scale(u.face || 1, 1);
  ctx.lineWidth = 0.75;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = c.ink;
  ctx.fillStyle = fill;

  const legs = (y0, spread = 1.4) => {
    line(ctx, -0.6, y0, -0.6 - ph * spread, 0);
    line(ctx, 0.6, y0, 0.6 + ph * spread, 0);
  };
  const eye = (x, y) => { ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(x, y, 0.45, 0, 7); ctx.fill(); ctx.fillStyle = fill; };

  switch (u.type) {
    case 'sword': {
      legs(-4);
      ctx.beginPath(); ctx.roundRect(-2.1, -9.2, 4.2, 5.4, 1.2); ctx.fill(); ctx.stroke();
      circ(ctx, 0, -11, 2.3); eye(1, -11.3);
      const a = swing ? 0.2 : -0.9;
      ctx.save(); ctx.translate(1.8, -6.6); ctx.rotate(a);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 0.9; line(ctx, 0, 0, 0, -6.5);
      ctx.strokeStyle = c.ink; ctx.lineWidth = 0.75; line(ctx, -1.2, -0.6, 1.2, -0.6);
      ctx.restore();
      break;
    }
    case 'roller': {
      const r = 4.5;
      const rot = (u.x / r) * (u.face || 1);
      if (u.round) { ctx.save(); ctx.strokeStyle = 'rgba(240,160,20,0.8)'; ctx.lineWidth = 0.9; circ(ctx, 0, -r, r + 1.3, false); ctx.restore(); }
      circ(ctx, 0, -r, r);
      ctx.save(); ctx.translate(0, -r); ctx.rotate(rot);
      for (let k = -1; k <= 1; k++) line(ctx, k * 1.6, -r * 0.95 + Math.abs(k) * 0.6, k * 1.6, r * 0.95 - Math.abs(k) * 0.6);
      ctx.restore();
      circ(ctx, 3.2, -r - 2.2, 1.1);
      eye(3.3, -r - 0.5);
      break;
    }
    case 'shield': {
      const planted = u.state === 'shield';
      legs(-4, planted ? 0 : 1.4);
      ctx.beginPath(); ctx.roundRect(-2.2, -9.2, 4.4, 5.4, 1.2); ctx.fill(); ctx.stroke();
      circ(ctx, 0, -11, 2.3); eye(1, -11.3);
      ctx.fillStyle = hit ? '#fff' : '#e7e3d8';
      if (planted) {
        ctx.beginPath(); ctx.roundRect(2.6, -15, 2.8, 15, 0.8); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = c.ink; ctx.lineWidth = 1.1; line(ctx, 4, -12.5, 4, -2.5);
        ctx.lineWidth = 0.6; line(ctx, 3.2, 0, 2.6, 1.6); line(ctx, 4.8, 0, 5.4, 1.6);
      } else {
        ctx.beginPath(); ctx.roundRect(2.2, -10.5, 2.2, 8, 0.8); ctx.fill(); ctx.stroke();
        line(ctx, 3.3, -9, 3.3, -4);
      }
      break;
    }
    case 'heavy': {
      legs(-5, 1);
      ctx.beginPath(); ctx.roundRect(-3.6, -11.5, 7.2, 7, 1.6); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(-2.6, -15, 5.2, 4, 1.4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.ink; ctx.fillRect(-0.2, -13.6, 2.6, 0.9); ctx.fillStyle = fill;
      ctx.save(); ctx.translate(3, -8); ctx.rotate(swing ? 0.6 : -0.5);
      ctx.strokeStyle = '#6b4b2a'; ctx.lineWidth = 0.9; line(ctx, 0, 0, 0, -7);
      ctx.fillStyle = '#777'; ctx.strokeStyle = '#333'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.roundRect(-1.6, -9.2, 3.2, 2.6, 0.5); ctx.fill(); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'archer': {
      legs(-4);
      ctx.beginPath(); ctx.roundRect(-1.9, -9.2, 3.8, 5.4, 1.2); ctx.fill(); ctx.stroke();
      circ(ctx, 0, -11, 2.2); eye(1, -11.2);
      ctx.beginPath(); ctx.moveTo(-2.4, -10.4); ctx.lineTo(0, -14.6); ctx.lineTo(2.4, -10.4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(1.8, -7, 4.2, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = '#999'; ctx.lineWidth = 0.3;
      line(ctx, 1.8 + 4.2 * Math.cos(1.25), -7 - 4.2 * Math.sin(1.25), swing ? 1.8 + 4.2 * Math.cos(1.25) : 0.8, -7);
      line(ctx, swing ? 1.8 + 4.2 * Math.cos(1.25) : 0.8, -7, 1.8 + 4.2 * Math.cos(1.25), -7 + 4.2 * Math.sin(1.25));
      break;
    }
    case 'gecko': {
      if (u.state === 'climb') { ctx.translate(1.5, -4); ctx.rotate(-Math.PI / 2); ctx.translate(0, 0); }
      ctx.beginPath(); ctx.ellipse(0, -2.6, 4, 1.9, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3.8, -2.4); ctx.quadraticCurveTo(-7.5, -2.5 + ph, -8, -5); ctx.stroke();
      circ(ctx, 4.4, -3.4, 1.7); eye(5, -3.9);
      line(ctx, 2, -1.2, 2.6 + ph, 0); line(ctx, -2, -1.2, -2.6 - ph, 0);
      break;
    }
    case 'herb': {
      legs(-4);
      ctx.beginPath(); ctx.moveTo(-2.6, -3.8); ctx.lineTo(-1.7, -9.4); ctx.lineTo(1.7, -9.4); ctx.lineTo(2.6, -3.8); ctx.closePath(); ctx.fill(); ctx.stroke();
      circ(ctx, 0, -11, 2.3); eye(1, -11.3);
      ctx.fillStyle = '#5aa53b'; ctx.strokeStyle = '#2e6b1f';
      ctx.beginPath(); ctx.ellipse(0.8, -14, 1.6, 0.8, -0.5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 0.7; line(ctx, 3, -1, 3, -11);
      ctx.fillStyle = '#7fc35a'; ctx.beginPath(); ctx.arc(3, -11.8, 1.1, 0, 7); ctx.fill();
      break;
    }
    case 'bomber': {
      legs(-4);
      circ(ctx, 0, -7.6, 3.6);
      circ(ctx, 0, -12, 2.2); eye(1, -12.2);
      ctx.fillStyle = c.ink; ctx.fillRect(-1.8, -12.9, 3.8, 0.8); ctx.fillStyle = fill;
      if (!swing) {
        ctx.fillStyle = '#222'; ctx.strokeStyle = '#222';
        circ(ctx, 3.6, -6.5, 1.5);
        ctx.strokeStyle = '#a66'; line(ctx, 4.4, -7.8, 5.2, -9);
        ctx.fillStyle = (Math.floor((u.anim ?? t) * 10) % 2) ? '#ffcc33' : '#ff7a1a';
        ctx.beginPath(); ctx.arc(5.3, -9.2, 0.6, 0, 7); ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function drawBar(ctx, u, team) {
  if (u.hp >= u.max || u.state === 'dead') return;
  const w = 9, y = u.y - u.d.h - 3.2;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(u.x - w / 2, y, w, 1.3);
  ctx.fillStyle = TEAM[team].ink;
  ctx.fillRect(u.x - w / 2, y, w * Math.max(0, u.hp / u.max), 1.3);
}

/* ---------------- 主畫面 ---------------- */

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.T = null;
    this.layer = buildTerrainLayer(null);
    this.ver = -1;
    this.parts = [];
    this.texts = [];
    this.flashes = [];
    this.shake = 0;
    this.t = 0;
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.dpr = dpr;
  }

  setTerrain(T) {
    this.T = T;
    this.ver = -1;
    if (T) T.dirty.length = 0;
    this.parts = []; this.texts = []; this.flashes = [];
  }

  addEvents(events) {
    for (const e of events) {
      switch (e.k) {
        case 'dust':
          for (let i = 0; i < e.n; i++) this.parts.push({ x: e.x + (Math.random() - 0.5) * 6, y: e.y - 0.5, vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 10, life: 0.5, max: 0.5, r: 0.8 + Math.random(), c: 'rgba(120,110,95,A)', g: 10 });
          break;
        case 'spark':
          for (let i = 0; i < 4; i++) this.parts.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 40, vy: -Math.random() * 30, life: 0.25, max: 0.25, r: 0.5, c: 'rgba(230,170,40,A)', g: 60 });
          break;
        case 'boom':
          this.flashes.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35 });
          for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 50;
            this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 25, life: 0.8, max: 0.8, r: 0.6 + Math.random() * 1.2, c: i % 3 ? 'rgba(110,90,70,A)' : 'rgba(255,150,40,A)', g: 90 });
          }
          this.shake = 0.3;
          break;
        case 'fizzle':
          for (let i = 0; i < 6; i++) this.parts.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 10, vy: -10 - Math.random() * 10, life: 0.8, max: 0.8, r: 1 + Math.random(), c: 'rgba(230,240,250,A)', g: -5 });
          this.texts.push({ x: e.x, y: e.y - 4, s: '噗嘶~', c: '#4a8ac0', life: 1, max: 1 });
          break;
        case 'boing':
          this.flashes.push({ x: e.x, y: e.y, r: 6, life: 0.25, max: 0.25, ring: '#d8342a' });
          break;
        case 'die':
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 25;
            this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, life: 0.7, max: 0.7, r: 0.6 + Math.random() * 0.8, c: e.team === 0 ? 'rgba(31,79,191,A)' : 'rgba(194,55,42,A)', g: 40 });
          }
          this.texts.push({ x: e.x, y: e.y - 6, s: '×_×', c: '#444', life: 1, max: 1 });
          break;
        case 'dmg':
          this.texts.push({ x: e.x + (Math.random() - 0.5) * 4, y: e.y, s: '-' + e.v, c: e.c || '#333', life: 0.8, max: 0.8 });
          break;
        case 'heal':
          if (e.v) this.texts.push({ x: e.x, y: e.y, s: '+' + e.v, c: '#2f8a2f', life: 0.9, max: 0.9 });
          for (let i = 0; i < 3; i++) this.parts.push({ x: e.x + (Math.random() - 0.5) * 5, y: e.y + 3, vx: 0, vy: -8 - Math.random() * 6, life: 0.7, max: 0.7, r: 0.6, c: 'rgba(70,170,70,A)', g: 0, plus: true });
          break;
        case 'txt':
          this.texts.push({ x: e.x, y: e.y, s: e.s, c: e.c, life: 1.2, max: 1.2, big: true });
          break;
      }
    }
  }

  // units / proj：畫面用的資料（單機直接是模擬物件，連線是快照）
  draw(units, proj, dt, overlay) {
    this.t += dt;
    this.resize();
    const { ctx, cv } = this;
    if (this.T && this.T.version !== this.ver) {
      const dirty = this.T.dirty.splice(0);
      if (this.ver >= 0 && dirty.length) {
        const lctx = this.layer.getContext('2d');
        for (const r of dirty) paintRegion(this.T, lctx, r, false, false);
      } else {
        this.layer = buildTerrainLayer(this.T);
      }
      this.ver = this.T.version;
    }
    const s = cv.width / GW;
    let ox = 0, oy = 0;
    if (this.shake > 0) {
      this.shake -= dt;
      ox = (Math.random() - 0.5) * s * 2.5; oy = (Math.random() - 0.5) * s * 2.5;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, ox, oy, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, ox, oy);

    if (overlay) overlay(ctx, s);

    // 陣亡記號
    for (const u of units) {
      if (u.state !== 'dead') continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - u.deadT * 1.5);
      if (ctx.globalAlpha > 0) { ctx.translate(0, -u.deadT * 6); drawUnit(ctx, u, u.team, this.t); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(60,60,60,0.35)'; ctx.lineWidth = 0.6;
      line(ctx, u.x - 1.4, u.y - 2.8, u.x + 1.4, u.y - 0.2); line(ctx, u.x + 1.4, u.y - 2.8, u.x - 1.4, u.y - 0.2);
    }
    for (const u of units) {
      if (u.state === 'dead') continue;
      if (u.wet) {
        ctx.fillStyle = 'rgba(120,180,240,0.7)';
        for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc(u.x + Math.sin(this.t * 6 + k * 3 + u.id) * 3, u.y - 1 - ((this.t * 3 + k * 0.5) % 1) * 3, 0.5, 0, 7); ctx.fill(); }
      }
      drawUnit(ctx, u, u.team, this.t);
      drawBar(ctx, u, u.team);
    }

    // 投射物
    for (const p of proj) {
      if (p.kind === 0) {
        const l = Math.hypot(p.vx, p.vy) || 1, dx = (p.vx / l) * 4.5, dy = (p.vy / l) * 4.5;
        ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = 0.5;
        line(ctx, p.x - dx, p.y - dy, p.x, p.y);
        ctx.fillStyle = '#333';
        ctx.beginPath(); ctx.moveTo(p.x + dx * 0.3, p.y + dy * 0.3); ctx.lineTo(p.x - dy * 0.15, p.y + dx * 0.15); ctx.lineTo(p.x + dy * 0.15, p.y - dx * 0.15); ctx.fill();
      } else {
        ctx.fillStyle = '#222'; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.3;
        circ(ctx, p.x, p.y, 1.5);
        ctx.fillStyle = Math.floor(this.t * 14) % 2 ? '#ffcc33' : '#ff6a1a';
        ctx.beginPath(); ctx.arc(p.x + 0.9, p.y - 1.6, 0.6, 0, 7); ctx.fill();
      }
    }

    // 爆炸閃光
    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    for (const f of this.flashes) {
      const k = 1 - f.life / f.max;
      if (f.ring) {
        ctx.strokeStyle = f.ring; ctx.globalAlpha = 1 - k; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * (0.5 + k), f.r * 0.4 * (0.5 + k), 0, 0, 7); ctx.stroke();
      } else {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#ffd25a';
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + k * 0.7), 0, 7); ctx.fill();
        ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 0.7; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 粒子
    this.parts = this.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of this.parts) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = Math.min(1, (p.life / p.max) * 1.4);
      ctx.fillStyle = p.c.replace('A', a.toFixed(2));
      if (p.plus) { ctx.fillRect(p.x - 0.9, p.y - 0.25, 1.8, 0.5); ctx.fillRect(p.x - 0.25, p.y - 0.9, 0.5, 1.8); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
    }

    // 文字（螢幕座標）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.texts = this.texts.filter((t) => (t.life -= dt) > 0);
    const fs = Math.max(11 * this.dpr, s * 3.6);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const k = 1 - t.life / t.max;
      const x = t.x * s + ox, y = (t.y - k * 7) * s + oy;
      ctx.globalAlpha = Math.min(1, t.life / t.max * 2.5);
      ctx.font = `800 ${Math.round(t.big ? fs * 1.05 : fs)}px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
      ctx.lineWidth = fs * 0.28;
      ctx.strokeStyle = 'rgba(255,253,245,0.95)';
      ctx.strokeText(t.s, x, y);
      ctx.fillStyle = t.c;
      ctx.fillText(t.s, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

// 圖示用：在小畫布上畫一個兵
export function unitIcon(canvas, type, team = 0) {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 44;
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  const d = UNITS[type];
  const s = canvas.width / 22;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  drawUnit(ctx, { type, x: 10.5, y: 18 + (d.h > 13 ? 1.5 : 0), face: 1, state: 'idle', anim: 0, hitT: 0, d }, team, 0);
}
