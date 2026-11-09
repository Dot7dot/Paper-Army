// 地形：照片 → 深色線條 → 格子地形 → 分析特殊形狀（圓形、尖角、凹槽、圓點）
//
// 線條偵測直接沿用 Draft Collective（filters.js）的線稿提取：
// 每個像素和周圍區域的平均亮度比較，「比周圍暗多少」超過深色閾值就算線條。
// 這樣紙張上的陰影、光線不均都不會被當成地形。

export const GW = 300;        // 地形格子寬（A4 橫放比例 ≈ 1.414）
export const GH = 212;        // 地形格子高
export const FLOOR = 4;       // 最下面幾排是桌面（永遠是地面）
const PROC_W = 900;           // 分析照片時的寬度
const PROC_H = 636;

// 每格的特殊屬性（bit flag）
export const F = { ROUND: 1, MOSS: 2, THORN: 4, MUSH: 8, WATER: 16 };

/* ---------------- 線稿提取（來自 Draft Collective filters.js） ---------------- */

// 回傳每個像素「比周圍暗多少」（0~1）
export function lineDiff(data, w, h) {
  const n = w * h;
  // 灰階（若有透明則視為白紙）
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = data[j + 3] / 255;
    const g = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    gray[i] = g * a + 255 * (1 - a);
  }
  // 輕微模糊去除雜訊（3x3）
  const soft = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w, y1 = y * w, y2 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x2 = Math.min(w - 1, x + 1);
      soft[y1 + x] = (
        gray[y0 + x0] + gray[y0 + x] + gray[y0 + x2] +
        gray[y1 + x0] + gray[y1 + x] * 2 + gray[y1 + x2] +
        gray[y2 + x0] + gray[y2 + x] + gray[y2 + x2]
      ) / 10;
    }
  }
  // 積分圖求區域平均
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 30));
  const diff = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h - 1, y + r) + 1;
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w - 1, x + r) + 1;
      const sum = integral[yb * W + xb] - integral[ya * W + xb] - integral[yb * W + xa] + integral[ya * W + xa];
      const mean = sum / ((xb - xa) * (yb - ya));
      // 相對於周圍亮度的暗度，在亮紙上更敏感
      diff[y * w + x] = (mean - soft[y * w + x]) / Math.max(40, mean);
    }
  }
  return diff;
}

// 暗度 → 線條不透明度（0~255）。level 0=淡 1=濃
export function lineAlpha(d, level) {
  const t = 0.30 - level * 0.27;
  const ramp = 0.10 + level * 0.06;
  const a = (d - t) / ramp;
  return a <= 0 ? 0 : a >= 1 ? 255 : Math.round(Math.sqrt(a) * 255);
}

/* ---------------- 照片 → 線條格子 ---------------- */

// src：已經剪裁、轉正的畫布。拉伸成 A4 比例後計算暗度
export function prepareImage(src) {
  const c = document.createElement('canvas');
  c.width = PROC_W;
  c.height = PROC_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PROC_W, PROC_H);
  ctx.drawImage(src, 0, 0, PROC_W, PROC_H);
  const data = ctx.getImageData(0, 0, PROC_W, PROC_H).data;
  return { w: PROC_W, h: PROC_H, diff: lineDiff(data, PROC_W, PROC_H) };
}

// 深色閾值 threshold：0~1，越大越嚴格（只有很深的線才算）
// 回傳 GW×GH 的 0/1 陣列（1 = 有線條）
export function strokesFromImage(prep, threshold) {
  const level = 1 - threshold;
  // lineAlpha(d) >= 128 等價於 d >= dark
  const t = 0.30 - level * 0.27, ramp = 0.10 + level * 0.06;
  const dark = t + ramp * (128 / 255) ** 2;
  const { w, h, diff } = prep;
  const sx = w / GW, sy = h / GH;
  const cnt = new Uint16Array(GW * GH);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GH - 1, Math.floor(y / sy)) * GW;
    for (let x = 0; x < w; x++) {
      if (diff[y * w + x] >= dark) cnt[gy + Math.min(GW - 1, Math.floor(x / sx))]++;
    }
  }
  const need = Math.max(1, Math.round(sx * sy * 0.15));
  const out = new Uint8Array(GW * GH);
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] >= need ? 1 : 0;
  removeSpecks(out, 4);
  removeBorder(out);
  return out;
}

// 拿掉貼著照片邊緣的線（紙張邊緣、桌子、陰影）：
// 幾乎所有格子都在邊緣 6 格內的區塊，視為雜訊
function removeBorder(m) {
  const B = 6;
  const comps = components(m, GW, GH, 8);
  for (const c of comps) {
    let edge = 0, touch = false;
    for (const i of c.cells) {
      const x = i % GW, y = (i / GW) | 0;
      const d = Math.min(x, y, GW - 1 - x, GH - 1 - y);
      if (d < B) edge++;
      if (d < 2) touch = true;
    }
    if (touch && edge >= c.cells.length * 0.6) for (const i of c.cells) m[i] = 0;
  }
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; c++; } }
    tmp[y * w + x] = s / c;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; } }
    out[y * w + x] = s / c;
  }
  return out;
}

// 自動找紙張：比桌面亮的區域中最大的一塊，回傳 0~1 的剪裁框
export function detectPaper(src) {
  const k = 240 / Math.max(src.width, src.height);
  const w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const raw = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) raw[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  // 先模糊，讓畫在紙上的細線消失（不然紙會被線切成好幾塊）
  const blurred = boxBlur(boxBlur(raw, w, h, 2), w, h, 2);
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) gray[i] = Math.round(blurred[i]);
  // 外圈（多半是桌子）和中間（多半是紙）的亮度中位數，用兩者之間的值當閾值
  const median = (pick) => {
    const h2 = new Uint32Array(256);
    let cnt = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pick(x, y)) { h2[gray[y * w + x]]++; cnt++; }
    let acc = 0;
    for (let t = 0; t < 256; t++) { acc += h2[t]; if (acc >= cnt / 2) return t; }
    return 255;
  };
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const outer = median((x, y) => x < ring || y < ring || x >= w - ring || y >= h - ring);
  const inner = median((x, y) => Math.abs(x - w / 2) < w * 0.25 && Math.abs(y - h / 2) < h * 0.25);
  if (inner - outer < 30) return null; // 看不出桌子，整張都是紙
  const thr = outer + (inner - outer) * 0.35; // 偏向桌面，避免陰影下的紙被切掉
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) bright[i] = gray[i] > thr ? 1 : 0;
  const comps = components(bright, w, h, 4);
  let big = null;
  for (const cc of comps) if (!big || cc.cells.length > big.cells.length) big = cc;
  if (!big || big.cells.length < n * 0.2) return null;
  // 每一排 / 每一欄有超過一半是紙的範圍
  const rows = new Uint16Array(h), cols = new Uint16Array(w);
  for (const i of big.cells) { rows[(i / w) | 0]++; cols[i % w]++; }
  let rowMax = 0, colMax = 0;
  for (const v of rows) rowMax = Math.max(rowMax, v);
  for (const v of cols) colMax = Math.max(colMax, v);
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < h - 1 && rows[y0] < rowMax * 0.5) y0++;
  while (y1 > 0 && rows[y1] < rowMax * 0.5) y1--;
  while (x0 < w - 1 && cols[x0] < colMax * 0.5) x0++;
  while (x1 > 0 && cols[x1] < colMax * 0.5) x1--;
  if (x1 - x0 < w * 0.3 || y1 - y0 < h * 0.3) return null;
  const ix = (x1 - x0) * 0.025, iy = (y1 - y0) * 0.025;
  return { x: (x0 + ix) / w, y: (y0 + iy) / h, w: (x1 - x0 + 1 - 2 * ix) / w, h: (y1 - y0 + 1 - 2 * iy) / h };
}

// 拿掉太小的雜點（紙張紋路、灰塵）
function removeSpecks(m, minSize) {
  const comps = components(m, GW, GH, 8);
  for (const c of comps) if (c.cells.length < minSize) for (const i of c.cells) m[i] = 0;
}

// 兩張圖疊加（雙人模式）
export function overlay(a, b) {
  const out = new Uint8Array(GW * GH);
  for (let i = 0; i < out.length; i++) out[i] = a[i] | b[i];
  return out;
}

// 線條格子 ⇄ 字串（網路傳輸用：bitset + base64）
export function encodeStrokes(m) {
  const bytes = new Uint8Array(Math.ceil(m.length / 8));
  for (let i = 0; i < m.length; i++) if (m[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function decodeStrokes(str) {
  const s = atob(str);
  const m = new Uint8Array(GW * GH);
  for (let i = 0; i < m.length; i++) m[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return m;
}

/* ---------------- 連通區域 ---------------- */

function components(mask, w, h, conn) {
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = comps.length;
    const cells = [];
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (conn === 4 && dx && dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && label[j] < 0) { label[j] = id; stack.push(j); }
        }
      }
    }
    comps.push({ id, cells });
  }
  return { length: comps.length, label, [Symbol.iterator]: () => comps[Symbol.iterator](), list: comps };
}

/* ---------------- 建立地形 ---------------- */

export class Terrain {
  // mechs：開放的地形機關（'round' 'moss' 'thorn' 'water' 'mush'），null = 全部開放
  constructor(strokes, mechs = null) {
    this.mechs = mechs ? new Set(mechs) : null;
    this.w = GW;
    this.h = GH;
    this.strokes = strokes;
    this.version = 0;
    this.dirty = []; // 炸出坑洞後需要重畫的範圍
    this.build();
  }

  idx(x, y) { return y * GW + x; }

  has(k) { return !this.mechs || this.mechs.has(k); }

  // 地圖外：左右與下方是牆，上方是空的
  solidAt(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= GW || y >= GH) return true;
    if (y < 0) return false;
    return this.solid[y * GW + x] === 1;
  }

  flagAt(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= GW || y < 0 || y >= GH) return 0;
    return this.flag[y * GW + x];
  }

  build() {
    const W = GW, H = GH, N = W * H;
    const src = this.strokes;

    // 1. 線條加粗一格，順便補起小縫隙
    const line = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!src[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < W && yy >= 0 && yy < H) line[yy * W + xx] = 1;
      }
    }
    for (let y = H - FLOOR; y < H; y++) for (let x = 0; x < W; x++) line[y * W + x] = 0;
    // 紙張最上緣常有陰影或紙邊，不算地形
    for (let y = 0; y < 3; y++) for (let x = 0; x < W; x++) line[y * W + x] = 0;

    // 2. 從天空（最上面一排）灌空氣進去；灌不到的地方（被線圍住）變成實心
    //    所以線條碰到紙張下緣或左右邊 → 下方成為實心山丘；封閉圖形 → 內部填滿
    const wall = new Uint8Array(N);
    for (let i = 0; i < N; i++) wall[i] = line[i];
    for (let y = H - FLOOR; y < H; y++) for (let x = 0; x < W; x++) wall[y * W + x] = 1;
    const air = new Uint8Array(N);
    const q = [];
    const seed = (i) => { if (!wall[i] && !air[i]) { air[i] = 1; q.push(i); } };
    for (let x = 0; x < W; x++) seed(x);
    while (q.length) {
      const i = q.pop();
      const x = i % W, y = (i / W) | 0;
      if (x > 0) seed(i - 1);
      if (x < W - 1) seed(i + 1);
      if (y > 0) seed(i - W);
      if (y < H - 1) seed(i + W);
    }
    const solid = new Uint8Array(N);
    const inside = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      solid[i] = air[i] ? 0 : 1;
      inside[i] = !air[i] && !wall[i] ? 1 : 0;
    }
    this.solid = solid;
    this.flag = new Uint8Array(N);
    this.features = { circles: [], spikes: [], mushrooms: [], pools: 0, round: 0 };

    this.classifyShapes(line, inside);
    this.surfaces();
    if (this.has('thorn')) this.findSpikes();
    if (this.has('round')) this.findRound();
    this.computeWater();
    this.version++;
  }

  // 圓形 → 青苔；小圓點 → 彈跳蘑菇
  classifyShapes(line, inside) {
    const W = GW, H = GH;
    const comps = components(line, W, H, 8);
    const holes = components(inside, W, H, 4);
    // 每個被圍住的區域屬於哪條線
    const owner = holes.list.map(() => ({ comps: new Set(), floor: false }));
    for (const hole of holes) {
      const o = owner[hole.id];
      for (const i of hole.cells) {
        const x = i % W, y = (i / W) | 0;
        if (y + 1 >= H - FLOOR) o.floor = true;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= W * H) continue;
          const c = comps.label[j];
          if (c >= 0) o.comps.add(c);
        }
        if (x === 0 || x === W - 1) o.floor = true;
      }
    }
    const shapes = comps.list.map((c) => ({ cells: c.cells.slice(), closed: false, shared: false }));
    holes.list.forEach((hole, k) => {
      const o = owner[k];
      if (o.comps.size === 1 && !o.floor) {
        const s = shapes[[...o.comps][0]];
        s.closed = true;
        for (const i of hole.cells) s.cells.push(i);
      } else {
        for (const c of o.comps) shapes[c].shared = true;
      }
    });

    for (const s of shapes) {
      if (s.shared) continue;
      const set = new Set(s.cells);
      let minX = W, maxX = 0, minY = H, maxY = 0, cx = 0, cy = 0;
      let touchesFloor = false;
      for (const i of s.cells) {
        const x = i % W, y = (i / W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        cx += x + 0.5; cy += y + 0.5;
        if (y + 1 >= H - FLOOR) touchesFloor = true;
      }
      const A = s.cells.length;
      cx /= A; cy /= A;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const box = { x: minX, y: minY, w: bw, h: bh, cx, cy };

      // 小圓點：塗滿的小塊（不是空心的圈）、接近正方
      const side = Math.max(bw, bh);
      if (!s.closed && A <= 180 && side <= 16 && side / Math.min(bw, bh) <= 1.8 && A / (bw * bh) >= 0.5) {
        if (!this.has('mush')) continue;
        for (const i of s.cells) this.flag[i] |= F.MUSH;
        this.features.mushrooms.push(box);
        continue;
      }
      // 圓形：封閉、外框到中心距離差不多一樣
      if (!s.closed || touchesFloor) continue;
      let sum = 0, sum2 = 0, rmin = 1e9, rmax = 0, nb = 0;
      for (const i of s.cells) {
        const x = i % W, y = (i / W) | 0;
        const edge = !set.has(i - 1) || !set.has(i + 1) || !set.has(i - W) || !set.has(i + W);
        if (!edge) continue;
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        sum += r; sum2 += r * r; nb++;
        if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      }
      const mean = sum / nb;
      const cv = Math.sqrt(Math.max(0, sum2 / nb - mean * mean)) / mean;
      if (mean < 6 && Math.max(bw, bh) <= 16) { // 很小的圈圈也當成圓點
        if (!this.has('mush')) continue;
        for (const i of s.cells) this.flag[i] |= F.MUSH;
        this.features.mushrooms.push(box);
        continue;
      }
      if (cv < 0.095 && rmin / rmax > 0.7 && this.has('moss')) {
        this.features.circles.push({ ...box, r: mean });
        // 圓形上面（朝上的外緣）長青苔
        for (const i of s.cells) {
          if (i - W >= 0 && !this.solid[i - W]) this.flag[i] |= F.MOSS | F.ROUND;
        }
      }
    }
  }

  // 每一欄所有「上表面」（實心且上面是空的）的高度
  surfaces() {
    const W = GW, H = GH;
    const cols = [];
    for (let x = 0; x < W; x++) {
      const list = [];
      for (let y = 0; y < H; y++) {
        if (this.solid[y * W + x] && (y === 0 || !this.solid[(y - 1) * W + x])) list.push(y);
      }
      cols.push(list);
    }
    this.cols = cols;
    return cols;
  }

  // 在 x 欄找從 y0 往下（包含 y0）最近的上表面，範圍 range
  surfaceBelow(x, y0, range) {
    if (x < 0 || x >= GW) return null;
    for (const y of this.cols[x]) if (y >= y0 && y <= y0 + range) return y;
    return null;
  }

  // 離 y 最近的上表面
  surfaceNear(x, y, range) {
    if (x < 0 || x >= GW) return null;
    let best = null, bd = range + 1;
    for (const yy of this.cols[x]) {
      const d = Math.abs(yy - y);
      if (d < bd) { bd = d; best = yy; }
    }
    return best;
  }

  // 尖角：往上突出、兩側都很陡的頂點 → 尖刺
  findSpikes() {
    const W = GW, H = GH;
    const cols = this.surfaces();
    const tips = [];
    for (let x = 4; x < W - 4; x++) {
      for (const y of cols[x]) {
        if (y >= H - FLOOR - 1) continue;
        if (this.flag[y * W + x] & F.MUSH) continue;
        // 左右兩格的上方 12 格內不能有表面（局部最高點）
        let top = true;
        for (let dx = -2; dx <= 2 && top; dx++) {
          if (!dx) continue;
          for (const s of cols[x + dx]) if (s < y && s >= y - 12) { top = false; break; }
        }
        if (!top) continue;
        // 兩側下降幅度（附近有一樣高或更高的表面 → 不是尖角；
        // 某一邊完全沒有地面 → 只是線條的端點，也不算）
        // 粗筆畫的尖角頂端比較寬，所以近（4 格）遠（7 格）各量一次
        const drop = (dir, D) => {
          for (const s of cols[x + dir * D]) if (s >= y - 12 && s <= y + 1) return 0;
          let prev = y;
          for (let k = 1; k <= D; k++) {
            const s = this.surfaceBelow(x + dir * k, prev - 1, 10);
            if (s === null) return 0;
            prev = s;
          }
          return prev - y;
        };
        const near = Math.min(drop(-1, 4), drop(1, 4));
        const far = x >= 7 && x < W - 7 ? Math.min(drop(-1, 7), drop(1, 7)) : 0;
        if (near >= 6 || far >= 11) tips.push({ x, y, s: Math.max(near, far) });
      }
    }
    // 相近的頂點合併成一個尖角
    tips.sort((a, b) => a.y - b.y || b.s - a.s);
    const spikes = [];
    for (const t of tips) {
      if (spikes.some((s) => Math.abs(s.x - t.x) < 8 && Math.abs(s.y - t.y) < 8)) continue;
      spikes.push(t);
    }
    // 標記尖刺：頂點附近 + 兩側陡峭的斜面一路往下
    const mark = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H - FLOOR) return;
      const i = y * W + x;
      if (!this.solid[i]) return;
      if (!this.solidAt(x - 1, y) || !this.solidAt(x + 1, y) || !this.solidAt(x, y - 1)) this.flag[i] |= F.THORN;
    };
    for (const s of spikes) {
      for (let y = s.y; y <= s.y + 4; y++) for (let x = s.x - 4; x <= s.x + 4; x++) mark(x, y);
      for (const dir of [-1, 1]) {
        let prev = s.y, flat = 0;
        for (let k = 1; k <= 24; k++) {
          const xx = s.x + dir * k;
          if (xx < 0 || xx >= W) break;
          const sy = this.surfaceBelow(xx, prev - 1, 30);
          if (sy === null) break;
          for (let r = Math.min(prev, sy) - 1; r <= sy + 1; r++) { mark(xx - dir, r); mark(xx, r); }
          if (sy - prev < 1 && k > 4) { if (++flat >= 2) break; } else if (sy - prev >= 1) flat = 0;
          prev = sy;
          if (sy - s.y > 80) break;
        }
      }
    }
    this.features.spikes = spikes.map(({ x, y }) => ({ x, y }));
  }

  // 圓滑面：坡度平順變化的弧形表面（滾滾的主場）
  findRound() {
    const W = GW, H = GH;
    const cols = this.cols;
    const sm = (x, y, range) => {
      let s = 0, n = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const v = this.surfaceNear(x + dx, y, range);
        if (v === null) return null;
        s += v; n++;
      }
      return s / n;
    };
    // 近（8 格）遠（14 格）兩種尺度量曲率：小圓丘和大而平緩的山丘都算
    const SCALES = [[8, 1.6], [14, 2.0]];
    const roundAt = (x, y) => {
      const c = sm(x, y, 4);
      if (c === null) return false;
      for (const [S, need] of SCALES) {
        const h = S >> 1, R = S + 4;
        const a = sm(x - S, y, R), b = sm(x + S, y, R);
        const a2 = sm(x - h, y, R), b2 = sm(x + h, y, R);
        if (a === null || b === null || a2 === null || b2 === null) continue;
        const curve = a + b - 2 * c;
        const slope = Math.abs(b2 - a2) / S;
        // 兩邊各自也要彎（避免「直線 + 一個轉角」被當成弧面）
        const ca = a + c - 2 * a2, cb = b + c - 2 * b2;
        if (Math.abs(curve) >= need && Math.abs(curve) <= 12 * S / 8 && slope < 1.6 &&
          Math.sign(ca) === Math.sign(curve) && Math.sign(cb) === Math.sign(curve) &&
          Math.abs(ca) >= 0.25 && Math.abs(cb) >= 0.25) return true;
      }
      return false;
    };
    let count = 0;
    for (let x = 9; x < W - 9; x++) {
      for (const y of cols[x]) {
        if (y >= H - FLOOR) continue;
        const i = y * W + x;
        if (this.flag[i] & (F.THORN | F.MUSH)) continue;
        if (roundAt(x, y)) { this.flag[i] |= F.ROUND; count++; }
      }
    }
    // 把零星的點連成一段（左右 2 格內有圓滑面就算）
    for (let x = 2; x < W - 2; x++) {
      for (const y of cols[x]) {
        const i = y * W + x;
        if (this.flag[i] & (F.ROUND | F.THORN | F.MUSH)) continue;
        const l = this.surfaceNear(x - 2, y, 2), r = this.surfaceNear(x + 2, y, 2);
        if (l !== null && r !== null && (this.flag[l * W + x - 2] & F.ROUND) && (this.flag[r * W + x + 2] & F.ROUND)) {
          this.flag[i] |= F.ROUND;
          count++;
        }
      }
    }
    this.features.round = count;
  }

  // 凹槽 → 積水（像下雨一樣，水會留在兩邊都比較高的地方，最深 10 格）
  computeWater() {
    const W = GW, H = GH, CAP = 10;
    for (let i = 0; i < this.flag.length; i++) this.flag[i] &= ~F.WATER;
    if (!this.has('water')) { this.features.pools = 0; return; }
    const top = new Int32Array(W);
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H && !this.solid[y * W + x]) y++;
      top[x] = y;
    }
    const peakL = new Int32Array(W), peakR = new Int32Array(W);
    for (let x = 0, m = H; x < W; x++) { m = Math.min(m, top[x]); peakL[x] = m; }
    for (let x = W - 1, m = H; x >= 0; x--) { m = Math.min(m, top[x]); peakR[x] = m; }
    const cand = new Uint8Array(W * H);
    for (let x = 0; x < W;) {
      const lvl = Math.max(peakL[x], peakR[x]);
      if (lvl >= top[x]) { x++; continue; }
      // 一段連續的凹槽
      let x2 = x, deep = 0;
      while (x2 < W && Math.max(peakL[x2], peakR[x2]) < top[x2]) { deep = Math.max(deep, top[x2]); x2++; }
      const level = Math.max(lvl, deep - CAP);
      for (let xx = x; xx < x2; xx++) for (let y = level; y < top[xx]; y++) cand[y * W + xx] = 1;
      x = x2;
    }
    // 會從底下或旁邊漏掉的水不算
    const comps = components(cand, W, H, 4);
    let pools = 0;
    for (const c of comps) {
      let leak = false;
      for (const i of c.cells) {
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i + W]) {
          if (j < 0 || j >= W * H) continue;
          if (!this.solid[j] && !cand[j]) { leak = true; break; }
        }
        if (leak) break;
      }
      if (leak || c.cells.length < 6) continue;
      pools++;
      for (const i of c.cells) this.flag[i] |= F.WATER;
    }
    this.features.pools = pools;
  }

  // 炸彈炸出坑洞（桌面炸不壞）
  carve(cx, cy, r) {
    const W = GW, H = GH;
    let changed = false;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - FLOOR - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        const i = y * W + x;
        if (this.solid[i]) { this.solid[i] = 0; changed = true; }
        this.flag[i] &= F.WATER;
      }
    }
    if (changed) {
      const before = new Uint8Array(this.flag.length);
      for (let i = 0; i < before.length; i++) before[i] = this.flag[i] & F.WATER;
      this.surfaces();
      this.computeWater();
      const M = 4;
      const box = { x0: cx - r - M, y0: cy - r - M, x1: cx + r + M, y1: cy + r + M };
      // 水可能從別的地方流掉，一起重畫
      for (let i = 0; i < before.length; i++) {
        if (before[i] === (this.flag[i] & F.WATER)) continue;
        const x = i % W, y = (i / W) | 0;
        box.x0 = Math.min(box.x0, x - M); box.x1 = Math.max(box.x1, x + M + 1);
        box.y0 = Math.min(box.y0, y - M); box.y1 = Math.max(box.y1, y + M + 1);
      }
      this.dirty.push(box);
      this.version++;
    }
    return changed;
  }

  // 從桌面往上連續實心的最高高度（畫出來的山有多高）
  maxHill() {
    let best = 0;
    for (let x = 0; x < GW; x++) {
      let y = GH - FLOOR - 1, h = 0;
      while (y >= 0 && this.solid[y * GW + x]) { y--; h++; }
      best = Math.max(best, h);
    }
    return best;
  }

  summary() {
    const f = this.features;
    return {
      circles: f.circles.length,
      spikes: f.spikes.length,
      mushrooms: f.mushrooms.length,
      pools: f.pools,
      round: f.round,
    };
  }
}
