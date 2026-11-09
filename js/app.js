import { GW, GH, FLOOR, Terrain, prepareImage, strokesFromImage, overlay, encodeStrokes, decodeStrokes, detectPaper } from './terrain.js';
import { UNITS, UNIT_TYPES, TERRAIN_HELP } from './units.js';
import { Battle, DT, DURATION, unitsFromSnapshot, projFromSnapshot } from './sim.js';
import { Renderer, TEAM, drawUnit, unitIcon, buildTerrainLayer } from './render.js';
import { LEVELS } from './levels.js';
import { Link, cleanCode } from './net.js';

const $ = (id) => document.getElementById(id);
const MAX_UNITS = 5;           // 雙人模式每人最多幾隻
const PROGRESS_KEY = 'paper-army-progress-v1';
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const S = {
  mode: null,          // 'solo' | 'local' | 'online'
  level: 0,
  player: 0,           // 目前在佈陣 / 畫圖的隊伍
  me: 0,               // 連線時自己的隊伍
  place: [[], []],     // 佈陣：{ type, x(0~1) }
  strokes: [null, null],
  lastStrokes: [null, null],
  sel: 'sword',
  ready: [null, null], // 連線：雙方送出的佈陣與地形（主機用）
};

/* =========================================================
   小工具
   ========================================================= */
let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(on) { $('busy').hidden = !on; }

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { stars: [] }; } catch { return { stars: [] }; }
}
function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* 私密模式 */ }
}

function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return cv.getContext('2d');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

function scaledCanvas(src, maxSide) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/* =========================================================
   畫面切換與返回
   ========================================================= */
let cur = 'home';
let armed = false;
const backs = {};

function show(id) {
  const prev = cur;
  cur = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  if (prev === 'home' && id !== 'home') stopHome();
  if (id === 'home' && prev !== 'home') startHome();
  if (prev === 'battle' && id !== 'battle') stopBattle();
  if (id !== 'home' && !armed) { history.pushState({ pa: 1 }, ''); armed = true; }
}
function goBack() { (backs[cur] || (() => show('home')))(); }
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', goBack));
window.addEventListener('popstate', () => {
  armed = false;
  if (cur !== 'home') goBack();
  if (cur !== 'home' && !armed) { history.pushState({ pa: 1 }, ''); armed = true; }
});

document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
  const a = b.dataset.act;
  if (a === 'solo') openLevels();
  if (a === 'online') openLobby();
  if (a === 'local') { S.mode = 'local'; S.player = 0; S.place = [[], []]; S.strokes = [null, null]; openDeploy(); }
  if (a === 'help') show('help');
}));

/* =========================================================
   首頁：示範戰鬥
   ========================================================= */
const home = { R: new Renderer($('homeCanvas')), strokes: null, battle: null, raf: 0, last: 0, endT: 0 };
const DEMO_ARMIES = [
  { team: 0, units: [{ type: 'sword', x: 0.08 }, { type: 'archer', x: 0.19 }, { type: 'roller', x: 0.3 }, { type: 'gecko', x: 0.4 }] },
  { team: 1, units: [{ type: 'heavy', x: 0.88 }, { type: 'sword', x: 0.6 }, { type: 'bomber', x: 0.84 }, { type: 'herb', x: 0.74 }] },
];

// 用程式畫一張「手繪」地形，示範各種機關
function demoStrokes() {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 636;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbf8f0'; ctx.fillRect(0, 0, 900, 636);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 7; ctx.lineCap = ctx.lineJoin = 'round';
  const path = (pts, close) => { ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); if (close) ctx.closePath(); ctx.stroke(); };
  // 左邊：從紙邊開始的圓弧山丘，上面浮著一個圓（青苔）
  ctx.beginPath(); ctx.moveTo(-10, 500); ctx.bezierCurveTo(120, 420, 260, 470, 380, 640); ctx.stroke();
  ctx.beginPath(); ctx.arc(172, 250, 46, 0, Math.PI * 2); ctx.stroke();
  // 中間：地上的小圓點（蘑菇）
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(430, 618, 12, 0, Math.PI * 2); ctx.fill();
  // 右邊：中間凹下去的台地（積水）
  ctx.beginPath(); ctx.moveTo(500, 640); ctx.lineTo(565, 565); ctx.quadraticCurveTo(645, 680, 725, 565); ctx.lineTo(790, 640); ctx.stroke();
  // 最右邊：尖刺
  path([[815, 640], [860, 470], [905, 640]]);
  return strokesFromImage(prepareImage(c), 0.35);
}

function newDemo() {
  const T = new Terrain(home.strokes);
  home.R.setTerrain(T);
  home.battle = new Battle(T, DEMO_ARMIES, (Math.random() * 1e9) | 0);
  home.endT = 0;
}

function homeLoop(now) {
  const dt = Math.min(0.1, (now - home.last) / 1000);
  home.last = now;
  const b = home.battle;
  home.acc = (home.acc || 0) + dt;
  while (home.acc >= DT) { b.step(); home.acc -= DT; }
  home.R.addEvents(b.takeEvents());
  home.R.draw(b.units, b.proj, dt);
  if (b.over && (home.endT += dt) > 2.5) newDemo();
  home.raf = requestAnimationFrame(homeLoop);
}
function startHome() {
  if (!home.strokes) home.strokes = demoStrokes();
  newDemo();
  home.last = performance.now();
  cancelAnimationFrame(home.raf);
  home.raf = requestAnimationFrame(homeLoop);
}
function stopHome() { cancelAnimationFrame(home.raf); }

/* =========================================================
   關卡
   ========================================================= */
function openLevels() {
  S.mode = 'solo';
  const prog = loadProgress();
  const list = $('levelList');
  list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const unlocked = i === 0 || (prog.stars[i - 1] || 0) > 0;
    const st = prog.stars[i] || 0;
    const b = document.createElement('button');
    b.className = 'level' + (unlocked ? '' : ' locked');
    b.innerHTML = `<span class="num">第 ${i + 1} 關</span><span class="name">${L.name}</span>
      <span class="meta">敵人 ${L.enemies.length} 隻・可派 ${L.slots} 隻</span>
      <span class="lv-stars">${unlocked ? '★'.repeat(st) + '<span style="color:#d8d0bd">' + '★'.repeat(3 - st) + '</span>' : '🔒'}</span>`;
    b.addEventListener('click', () => {
      if (!unlocked) { toast('先通過前一關'); return; }
      if (S.level !== i) S.place = [[], []];
      S.level = i;
      S.player = 0;
      openDeploy();
    });
    list.appendChild(b);
  });
  show('levels');
}
backs.levels = () => show('home');

/* =========================================================
   佈陣
   ========================================================= */
let deployLayer = null;

function deployLimit() { return S.mode === 'solo' ? LEVELS[S.level].slots : MAX_UNITS; }
function deployRoster() { return S.mode === 'solo' ? LEVELS[S.level].roster : UNIT_TYPES; }

function openDeploy() {
  const team = S.player;
  const roster = deployRoster();
  if (!roster.includes(S.sel)) S.sel = roster[0];
  let title, hint;
  if (S.mode === 'solo') {
    const L = LEVELS[S.level];
    title = `第 ${S.level + 1} 關・${L.name}`;
    hint = '💡 ' + L.hint;
  } else if (S.mode === 'local') {
    title = `玩家 ${team + 1} 佈陣`;
    hint = `你是<b class="t${team}">${TEAM[team].name}（${team ? '右邊' : '左邊'}）</b>。自由選兵，最多 ${MAX_UNITS} 隻。佈陣完再畫自己的地形，兩張圖會疊在一起。`;
  } else {
    title = '你的佈陣';
    hint = `你是<b class="t${team}">${TEAM[team].name}（${team ? '右邊' : '左邊'}）</b>。自由選兵，最多 ${MAX_UNITS} 隻。對手看不到你的佈陣！`;
  }
  $('deployTitle').textContent = title;
  $('deployHint').innerHTML = hint;
  // 單人模式重玩時淡淡顯示上一張地形
  const ghost = S.mode === 'solo' && S.lastStrokes[0];
  deployLayer = buildTerrainLayer(ghost ? new Terrain(S.lastStrokes[0]) : null, { ghost: true });
  buildRoster();
  show('deploy');
  requestAnimationFrame(drawDeploy);
}

backs.deploy = () => {
  if (S.mode === 'solo') openLevels();
  else if (S.mode === 'online') { if (confirm('離開房間？')) leaveOnline(); }
  else show('home');
};

function buildRoster() {
  const box = $('roster');
  box.innerHTML = '';
  const team = S.player;
  for (const type of deployRoster()) {
    const d = UNITS[type];
    const b = document.createElement('button');
    b.className = 'unit-btn' + (type === S.sel ? ' sel' : '');
    b.innerHTML = `<canvas></canvas><span class="nm">${d.name}</span><span class="tp">${d.tip}</span>`;
    const n = S.place[team].filter((p) => p.type === type).length;
    if (n) b.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
    b.addEventListener('click', () => { S.sel = type; buildRoster(); });
    box.appendChild(b);
    requestAnimationFrame(() => unitIcon(b.querySelector('canvas'), type, team));
  }
  const d = UNITS[S.sel];
  const range = d.ranged || d.lob ? `${d.range} 格` : '近身';
  $('unitInfo').innerHTML = `<h4>${d.name} <small>・${d.role}</small></h4>
    <div class="stats"><span>血量 <b>${d.hp}</b></span><span>攻擊 <b>${d.atk}</b></span><span>射程 <b>${range}</b></span>
    <span>速度 <b>${d.speed}</b></span><span>爬坡 <b>${d.climb ? '垂直' : d.slope + '°'}</b></span></div>${d.trait}`;
  $('deploySlots').textContent = `${S.place[team].length} / ${deployLimit()}`;
}

function drawDeploy() {
  const cv = $('deployCanvas');
  const ctx = fitCanvas(cv);
  const s = cv.width / GW;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(deployLayer, 0, 0, cv.width, cv.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const team = S.player;
  ctx.fillStyle = team === 0 ? 'rgba(31,79,191,0.09)' : 'rgba(194,55,42,0.09)';
  ctx.fillRect(team === 0 ? 0 : GW / 2, 0, GW / 2, GH);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(GW / 2, 0); ctx.lineTo(GW / 2, GH); ctx.stroke();
  ctx.fillStyle = 'rgba(140,110,80,0.35)';
  ctx.fillRect(0, GH - FLOOR, GW, FLOOR);

  const drawList = (list, t, alpha) => {
    for (const p of list) {
      const x = p.x * GW;
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = TEAM[t].ink;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, GH - FLOOR - 2); ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(x, 37);
      ctx.scale(1.6, 1.6);
      drawUnit(ctx, { type: p.type, x: 0, y: 0, face: t === 0 ? 1 : -1, state: 'idle', anim: 0, hitT: 0 }, t, 0);
      ctx.restore();
      // 降落傘
      ctx.strokeStyle = TEAM[t].ink;
      ctx.lineWidth = 0.5;
      ctx.fillStyle = t === 0 ? 'rgba(207,220,251,0.9)' : 'rgba(249,211,204,0.9)';
      ctx.beginPath(); ctx.arc(x, 10, 7, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 7, 10); ctx.lineTo(x - 1.5, 15.5); ctx.moveTo(x + 7, 10); ctx.lineTo(x + 1.5, 15.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  ctx.setLineDash([2, 2]);
  if (S.mode === 'solo') drawList(LEVELS[S.level].enemies, 1, 0.85);
  ctx.setLineDash([]);
  drawList(S.place[team], team, 1);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `700 ${Math.round(cv.width / 34)}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.textAlign = 'center';
  ctx.fillText(team === 0 ? '← 你的陣地' : '你的陣地 →', (team === 0 ? 0.25 : 0.75) * cv.width, cv.height * 0.62);
  if (S.mode === 'solo') ctx.fillText('敵軍', 0.75 * cv.width, cv.height * 0.62);
}

$('deployCanvas').addEventListener('pointerdown', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * GW;
  const team = S.player;
  const list = S.place[team];
  // 點到已放的兵 → 收回
  let hit = -1, hd = 9;
  list.forEach((p, i) => { const d = Math.abs(p.x * GW - x); if (d < hd) { hd = d; hit = i; } });
  if (hit >= 0) { list.splice(hit, 1); buildRoster(); drawDeploy(); return; }
  const mine = team === 0 ? x < GW / 2 : x > GW / 2;
  if (!mine) { toast('只能放在自己這半邊'); return; }
  if (list.length >= deployLimit()) { toast(`最多 ${deployLimit()} 隻`); return; }
  const f = Math.min(team === 0 ? 0.47 : 0.97, Math.max(team === 0 ? 0.03 : 0.53, x / GW));
  list.push({ type: S.sel, x: Math.round(f * 1000) / 1000 });
  buildRoster();
  drawDeploy();
});

$('deployClear').addEventListener('click', () => { S.place[S.player] = []; buildRoster(); drawDeploy(); });
$('deployNext').addEventListener('click', () => {
  if (!S.place[S.player].length) { toast('至少放一隻兵'); return; }
  openDraw();
});
window.addEventListener('resize', () => {
  if (cur === 'deploy') drawDeploy();
  if (cur === 'adjust') { layoutCrop(); preview.draw([], [], 0); }
  if (cur === 'finger') drawFinger();
});

/* =========================================================
   畫地形（說明 + 拍照 / 相簿 / 手指畫）
   ========================================================= */
const GUIDE_SVG = {
  line: '<path d="M2 44 C 12 18, 28 14, 40 28 S 56 34 62 44Z" fill="#d6cdb8" stroke="#23222a" stroke-width="2.5" stroke-linejoin="round"/><path d="M2 44 H62" stroke="#a87a50" stroke-width="3"/>',
  moss: '<circle cx="32" cy="27" r="13" fill="#d6cdb8" stroke="#23222a" stroke-width="2.5"/><path d="M21 21 A13 13 0 0 1 43 21" stroke="#5aa53b" stroke-width="5" fill="none" stroke-linecap="round"/>',
  thorn: '<path d="M4 44 L18 12 L28 44 L38 8 L50 44Z" fill="#d6cdb8" stroke="#23222a" stroke-width="2.5" stroke-linejoin="round"/><path d="M15 16 L18 6 L21 16Z M35 12 L38 2 L41 12Z" fill="#9c2222"/>',
  water: '<path d="M10 22 Q 14 40 32 40 Q 50 40 54 22Z" fill="#7cb9ea"/><path d="M6 6 Q 10 42 32 42 Q 54 42 58 6" fill="none" stroke="#23222a" stroke-width="2.5"/>',
  mush: '<circle cx="14" cy="36" r="5" fill="#23222a"/><path d="M24 34 H32 M29 30 L33 34 L29 38" stroke="#23222a" stroke-width="2" fill="none"/><rect x="45" y="30" width="6" height="12" fill="#efe2c4" stroke="#23222a" stroke-width="2"/><path d="M38 31 A10 9 0 0 1 58 31Z" fill="#d8342a" stroke="#23222a" stroke-width="2"/><circle cx="44" cy="27" r="1.5" fill="#fff"/><circle cx="51" cy="25" r="1.5" fill="#fff"/>',
  round: '<path d="M2 44 C 10 10, 54 10, 62 44Z" fill="#d6cdb8" stroke="#23222a" stroke-width="2.5"/><g fill="#e2a01e"><circle cx="16" cy="22" r="2"/><circle cx="26" cy="16" r="2"/><circle cx="38" cy="16" r="2"/><circle cx="48" cy="22" r="2"/></g>',
  slope: '<path d="M2 44 H30 L36 6 H62 V44Z" fill="#d6cdb8" stroke="#23222a" stroke-width="2.5" stroke-linejoin="round"/><text x="14" y="34" font-size="16" font-weight="900" fill="#c2372a">!</text>',
};

function renderGuide(el) {
  el.innerHTML = TERRAIN_HELP.map((g) => `<div class="g-item"><svg viewBox="0 0 64 46">${GUIDE_SVG[g.key]}</svg><div><h4>${g.name}</h4><p>${g.desc}</p></div></div>`).join('');
}
renderGuide($('terrainGuide'));
renderGuide($('helpGuide'));

function openDraw() {
  const p = S.player;
  $('drawTitle').textContent = S.mode === 'solo' ? '畫地形' : `玩家 ${p + 1} 畫地形`;
  if (S.mode === 'online') $('drawTitle').textContent = '畫你的地形';
  $('reuseBtn').hidden = !S.lastStrokes[p];
  show('draw');
}
backs.draw = () => openDeploy();

$('camBtn').addEventListener('click', () => $('camInput').click());
$('pickBtn').addEventListener('click', () => $('pickInput').click());
$('fingerBtn').addEventListener('click', () => openFinger());
$('reuseBtn').addEventListener('click', () => terrainDone(S.lastStrokes[S.player]));

for (const id of ['camInput', 'pickInput']) {
  $(id).addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    busy(true);
    try {
      const img = await loadImage(file);
      await openAdjust(img, false);
    } catch (err) {
      console.error(err);
      toast('讀不到這張照片，請再試一次');
    } finally {
      busy(false);
    }
  });
}

/* ---------------- 手指畫 ---------------- */
const fd = { paths: [], cur: null, thick: false };

function openFinger() {
  show('finger');
  requestAnimationFrame(drawFinger);
}
backs.finger = () => openDraw();

function paintPaths(ctx, w, h) {
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1d1d22';
  for (const p of fd.paths) {
    ctx.lineWidth = p.w * w;
    ctx.beginPath();
    p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    if (p.pts.length === 1) ctx.lineTo(p.pts[0][0] * w + 0.1, p.pts[0][1] * h);
    ctx.stroke();
  }
}

function drawFinger() {
  const cv = $('fingerCanvas');
  const ctx = fitCanvas(cv);
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = 'rgba(90,130,190,0.13)';
  ctx.lineWidth = 1;
  const step = cv.width / 30;
  ctx.beginPath();
  for (let x = step; x < cv.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); }
  for (let y = step; y < cv.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(cv.width, y); }
  ctx.stroke();
  paintPaths(ctx, cv.width, cv.height);
}

{
  const cv = $('fingerCanvas');
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    fd.cur = { w: fd.thick ? 0.03 : 0.012, pts: [pos(e)] };
    fd.paths.push(fd.cur);
    drawFinger();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!fd.cur) return;
    fd.cur.pts.push(pos(e));
    drawFinger();
  });
  const end = () => { fd.cur = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}
$('fingerUndo').addEventListener('click', () => { fd.paths.pop(); drawFinger(); });
$('fingerClear').addEventListener('click', () => { fd.paths = []; drawFinger(); });
$('fingerPen').addEventListener('click', () => {
  fd.thick = !fd.thick;
  $('fingerPen').textContent = fd.thick ? '細筆' : '粗筆';
});
$('fingerDone').addEventListener('click', async () => {
  if (!fd.paths.length) { toast('先畫點東西吧'); return; }
  const c = document.createElement('canvas');
  c.width = 900; c.height = 636;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  paintPaths(ctx, c.width, c.height);
  busy(true);
  try { await openAdjust(c, true); } finally { busy(false); }
});

/* ---------------- 調整：剪裁、深色閾值、預覽 ---------------- */
const adj = { base: null, rot: 0, rc: null, rcRot: -1, crop: null, prep: null, strokes: null, finger: false, view: null, drag: null };
const preview = new Renderer($('previewCanvas'));

async function openAdjust(src, finger) {
  adj.base = scaledCanvas(src, 1600);
  adj.finger = finger;
  adj.rot = !finger && adj.base.height > adj.base.width ? 1 : 0; // 直拍自動轉成橫的
  adj.rcRot = -1;
  adj.crop = finger ? { x: 0, y: 0, w: 1, h: 1 } : autoCrop();
  $('cropWrap').hidden = finger;
  $('rotBtn').hidden = finger;
  $('retakeBtn').textContent = finger ? '重畫' : '重拍';
  $('adjustOk').textContent = S.mode === 'solo' || (S.mode === 'local' && S.player === 1) ? '開戰！' : S.mode === 'online' ? '送出地形' : '完成 ›';
  show('adjust');
  await nextFrame();
  layoutCrop();
  await processCrop();
}
backs.adjust = () => (adj.finger ? openFinger() : openDraw());
$('retakeBtn').addEventListener('click', () => (adj.finger ? openFinger() : $('camInput').click()));

// 自動找出照片中的紙張；找不到就用預設框
function autoCrop() {
  try {
    const r = detectPaper(rotated());
    if (r) return r;
  } catch (err) { console.warn(err); }
  return { x: 0.03, y: 0.03, w: 0.94, h: 0.94 };
}

function rotated() {
  if (adj.rc && adj.rcRot === adj.rot) return adj.rc;
  const b = adj.base;
  const c = document.createElement('canvas');
  const odd = adj.rot % 2 === 1;
  c.width = odd ? b.height : b.width;
  c.height = odd ? b.width : b.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((adj.rot * Math.PI) / 2);
  ctx.drawImage(b, -b.width / 2, -b.height / 2);
  adj.rc = c;
  adj.rcRot = adj.rot;
  return c;
}

function layoutCrop() {
  if (adj.finger || !adj.base) return;
  const wrap = $('cropWrap'), cv = $('cropCanvas');
  const r = rotated();
  const k = Math.min(wrap.clientWidth / r.width, wrap.clientHeight / r.height);
  cv.style.width = `${Math.round(r.width * k)}px`;
  cv.style.height = `${Math.round(r.height * k)}px`;
  drawCrop();
}

function drawCrop() {
  const cv = $('cropCanvas');
  const ctx = fitCanvas(cv);
  const W = cv.width, H = cv.height;
  ctx.drawImage(rotated(), 0, 0, W, H);
  const c = adj.crop;
  const x = c.x * W, y = c.y * H, w = c.w * W, h = c.h * H;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(x, y, w, h);
  ctx.fill('evenodd');
  const dpr = W / cv.clientWidth;
  ctx.strokeStyle = '#f2c443';
  ctx.lineWidth = 2.5 * dpr;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#f2c443';
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.beginPath(); ctx.arc(hx, hy, 9 * dpr, 0, 7); ctx.fill();
  }
}

{
  const cv = $('cropCanvas');
  const norm = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; };
  cv.addEventListener('pointerdown', (e) => {
    const [nx, ny, r] = norm(e);
    const c = adj.crop;
    const corners = [[c.x, c.y, 'tl'], [c.x + c.w, c.y, 'tr'], [c.x, c.y + c.h, 'bl'], [c.x + c.w, c.y + c.h, 'br']];
    let best = null, bd = 34;
    for (const [hx, hy, k] of corners) {
      const d = Math.hypot((hx - nx) * r.width, (hy - ny) * r.height);
      if (d < bd) { bd = d; best = k; }
    }
    if (!best && (nx < c.x || nx > c.x + c.w || ny < c.y || ny > c.y + c.h)) return;
    cv.setPointerCapture(e.pointerId);
    adj.drag = { k: best || 'move', sx: nx, sy: ny, c0: { ...c } };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!adj.drag) return;
    const [nx, ny] = norm(e);
    const { k, sx, sy, c0 } = adj.drag;
    const dx = nx - sx, dy = ny - sy, M = 0.12;
    let { x, y, w, h } = c0;
    if (k === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      let x2 = x + w, y2 = y + h;
      if (k[1] === 'l') x = Math.min(x2 - M, Math.max(0, x + dx)); else x2 = Math.max(x + M, Math.min(1, x2 + dx));
      if (k[0] === 't') y = Math.min(y2 - M, Math.max(0, y + dy)); else y2 = Math.max(y + M, Math.min(1, y2 + dy));
      w = x2 - x; h = y2 - y;
    }
    adj.crop = { x, y, w, h };
    drawCrop();
  });
  const end = () => { if (adj.drag) { adj.drag = null; processCrop(); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

$('rotBtn').addEventListener('click', async () => {
  adj.rot = (adj.rot + 1) % 4;
  adj.crop = autoCrop();
  layoutCrop();
  await processCrop();
});

async function processCrop() {
  busy(true);
  await nextFrame();
  try {
    const r = rotated();
    const c = adj.crop;
    const cc = document.createElement('canvas');
    cc.width = Math.max(1, Math.round(c.w * r.width));
    cc.height = Math.max(1, Math.round(c.h * r.height));
    cc.getContext('2d').drawImage(r, c.x * r.width, c.y * r.height, cc.width, cc.height, 0, 0, cc.width, cc.height);
    adj.prep = prepareImage(cc);
    updateStrokes();
  } finally {
    busy(false);
  }
}

function updateStrokes() {
  if (!adj.prep) return;
  const thr = Number($('thrRange').value) / 100;
  $('thrVal').textContent = $('thrRange').value;
  adj.strokes = strokesFromImage(adj.prep, thr);
  const T = new Terrain(adj.strokes);
  preview.setTerrain(T);
  preview.draw([], [], 0);
  const f = T.summary();
  const chips = [];
  if (f.circles) chips.push(`<span class="chip moss">圓形 ×${f.circles} → 青苔</span>`);
  if (f.spikes) chips.push(`<span class="chip thorn">尖角 ×${f.spikes} → 尖刺</span>`);
  if (f.pools) chips.push(`<span class="chip water">凹槽 ×${f.pools} → 水窪</span>`);
  if (f.mushrooms) chips.push(`<span class="chip mush">圓點 ×${f.mushrooms} → 蘑菇</span>`);
  if (f.round > 12) chips.push('<span class="chip round">有圓滑弧面</span>');
  let ink = 0;
  for (let i = 0; i < adj.strokes.length; i++) ink += adj.strokes[i];
  if (!ink) chips.push('<span class="chip">沒有偵測到線條：把閾值往左調，或畫深一點</span>');
  else if (ink > adj.strokes.length * 0.25) chips.push('<span class="chip">線條太多了：把閾值往右調，或剪掉紙張外的部分</span>');
  else if (!chips.length) chips.push('<span class="chip">沒有特殊形狀，只有一般地面</span>');
  $('featList').innerHTML = chips.join('');
}

let thrRAF = 0;
$('thrRange').addEventListener('input', () => {
  cancelAnimationFrame(thrRAF);
  thrRAF = requestAnimationFrame(updateStrokes);
});

$('adjustOk').addEventListener('click', () => {
  if (!adj.strokes) return;
  terrainDone(adj.strokes);
});

/* =========================================================
   地形完成 → 下一步
   ========================================================= */
function terrainDone(strokes) {
  const p = S.player;
  S.strokes[p] = strokes;
  S.lastStrokes[p] = strokes;
  if (S.mode === 'solo') {
    const L = LEVELS[S.level];
    startBattle(strokes, [{ team: 0, units: S.place[0] }, { team: 1, units: L.enemies }], (Math.random() * 1e9) | 0, 'local');
  } else if (S.mode === 'local') {
    if (p === 0) { show('pass'); return; }
    startBattle(overlay(S.strokes[0], S.strokes[1]), [{ team: 0, units: S.place[0] }, { team: 1, units: S.place[1] }], (Math.random() * 1e9) | 0, 'local');
  } else if (S.mode === 'online') {
    const msg = { units: S.place[S.me], strokes: encodeStrokes(strokes) };
    $('waitMsg').textContent = '對手還在佈陣或畫地形。';
    show('wait');
    if (link.role === 'host') { S.ready[0] = msg; hostCheckStart(); } else link.send({ t: 'ready', ...msg });
  }
}

$('passBtn').addEventListener('click', () => { S.player = 1; openDeploy(); });
backs.pass = () => { if (confirm('放棄這場對戰？')) show('home'); };

/* =========================================================
   戰鬥
   ========================================================= */
const B = { R: new Renderer($('battleCanvas')), battle: null, T: null, units: [], proj: [], role: 'local', acc: 0, speed: 1, last: 0, raf: 0, ended: false, time: 0, pending: [], tick: 0, result: null };

function startBattle(strokes, armies, seed, role) {
  B.T = new Terrain(strokes);
  B.role = role;
  B.battle = role === 'guest' ? null : new Battle(B.T, armies, seed);
  B.units = B.battle ? B.battle.units : [];
  B.proj = [];
  B.R.setTerrain(B.T);
  B.acc = 0; B.time = 0; B.ended = false; B.pending = []; B.tick = 0; B.result = null;
  B.speed = 1;
  $('speedBtn').textContent = '速度 ×1';
  $('speedBtn').style.visibility = role === 'local' ? 'visible' : 'hidden';
  $('result').hidden = true;
  $('battleNote').textContent = S.mode === 'online' ? `你是${TEAM[S.me].name}（${S.me ? '右邊' : '左邊'}）` : '';
  show('battle');
  B.last = performance.now();
  cancelAnimationFrame(B.raf);
  B.raf = requestAnimationFrame(battleLoop);
}

function stopBattle() { cancelAnimationFrame(B.raf); }

function battleLoop(now) {
  const dt = Math.min(0.1, (now - B.last) / 1000);
  B.last = now;
  if (B.battle) {
    const b = B.battle;
    B.acc += dt * B.speed;
    let n = 0;
    while (B.acc >= DT && !b.over && n < 10) {
      b.step();
      B.acc -= DT; n++;
      B.tick++;
    }
    if (b.over) B.acc = 0;
    const ev = b.takeEvents();
    B.R.addEvents(ev);
    if (B.role === 'host') {
      B.pending.push(...ev);
      if (B.tick >= 2 || b.over) {
        link.send({ t: 'snap', s: b.snapshot(), e: B.pending });
        B.pending = []; B.tick = 0;
      }
    }
    B.units = b.units; B.proj = b.proj; B.time = b.time;
    if (b.over && !B.ended) {
      B.ended = true;
      if (B.role === 'host') link.send({ t: 'end', r: b.result });
      setTimeout(() => showResult(b.result), 1000);
    }
  } else {
    const k = Math.min(1, dt * 14);
    for (const u of B.units) {
      u.x += (u.tx - u.x) * k; u.y += (u.ty - u.y) * k;
      u.anim = (u.anim || 0) + dt;
      if (u.state === 'dead') u.deadT += dt;
    }
    for (const p of B.proj) { p.x += p.vx * dt; p.y += p.vy * dt; }
  }
  B.R.draw(B.units, B.proj, dt);
  hud();
  B.raf = requestAnimationFrame(battleLoop);
}

function hud() {
  let a0 = 0, a1 = 0;
  for (const u of B.units) if (u.state !== 'dead') (u.team === 0 ? a0++ : a1++);
  $('cnt0').textContent = a0;
  $('cnt1').textContent = a1;
  const left = Math.max(0, Math.ceil(DURATION - B.time));
  $('timer').textContent = left;
  $('timer').classList.toggle('low', left <= 10);
}

$('speedBtn').addEventListener('click', () => {
  B.speed = B.speed === 1 ? 2 : B.speed === 2 ? 4 : 1;
  $('speedBtn').textContent = `速度 ×${B.speed}`;
});
$('quitBtn').addEventListener('click', goBack);
backs.battle = () => {
  if (!B.ended && !confirm('確定要離開這場戰鬥嗎？')) return;
  if (S.mode === 'solo') openLevels();
  else if (S.mode === 'online') leaveOnline();
  else show('home');
};

function showResult(res) {
  B.result = res;
  const [a0, a1] = res.alive;
  const title = $('resTitle'), text = $('resText'), stars = $('resStars'), btns = $('resBtns');
  btns.innerHTML = '';
  stars.innerHTML = '';
  const btn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  const timeUp = res.time >= DURATION - 0.01;
  const why = timeUp ? '時間到！' : '';
  if (S.mode === 'solo') {
    const win = res.winner === 0;
    title.textContent = win ? '勝利！' : res.winner === -1 ? '平手' : '落敗…';
    text.textContent = `${why}你剩下 ${a0} 隻，敵人剩下 ${a1} 隻。`;
    if (win) {
      const placed = S.place[0].length;
      const st = 1 + (a0 >= Math.ceil(placed / 2) ? 1 : 0) + (a0 === placed ? 1 : 0);
      stars.innerHTML = '★'.repeat(st) + `<span class="off">${'★'.repeat(3 - st)}</span>`;
      const prog = loadProgress();
      prog.stars[S.level] = Math.max(prog.stars[S.level] || 0, st);
      saveProgress(prog);
      if (S.level + 1 < LEVELS.length) btn('下一關 ›', 'primary', () => { S.level++; S.place = [[], []]; S.lastStrokes = [null, null]; openDeploy(); });
      else text.textContent += ' 全部關卡都過了，你是紙上名將！';
    } else {
      text.textContent += ' 換個佈陣或地形再試試！';
    }
    btn('再試一次', win ? '' : 'primary', () => openDeploy());
    btn('關卡選單', 'ghost', () => openLevels());
  } else if (S.mode === 'local') {
    title.textContent = res.winner === -1 ? '平手' : `${TEAM[res.winner].name}勝利！`;
    text.textContent = `${why}藍隊剩下 ${a0} 隻，紅隊剩下 ${a1} 隻。`;
    btn('再來一局', 'primary', () => { S.player = 0; S.strokes = [null, null]; openDeploy(); });
    btn('回首頁', 'ghost', () => show('home'));
  } else {
    const me = S.me, mine = res.alive[me], theirs = res.alive[1 - me];
    title.textContent = res.winner === me ? '勝利！' : res.winner === -1 ? '平手' : '落敗…';
    text.textContent = `${why}你剩下 ${mine} 隻，對手剩下 ${theirs} 隻。`;
    btn('再來一局', 'primary', () => { link.send({ t: 'again' }); S.player = S.me; openDeploy(); });
    btn('離開房間', 'ghost', () => leaveOnline());
  }
  title.style.color = res.winner === -1 ? 'var(--ink)' : (S.mode === 'local' ? TEAM[res.winner].ink : (res.winner === (S.mode === 'online' ? S.me : 0) ? '#c99a10' : 'var(--ink-soft)'));
  $('result').hidden = false;
}

/* =========================================================
   雙人連線
   ========================================================= */
const link = new Link({
  status: (m) => { $('lobbyStatus').textContent = m; },
  error: (m) => { $('lobbyStatus').textContent = m; toast(m, 3200); },
  open: () => {
    S.mode = 'online';
    S.me = link.role === 'host' ? 0 : 1;
    S.player = S.me;
    S.place = [[], []];
    S.lastStrokes = [null, null];
    S.ready = [null, null];
    toast('連線成功！開始佈陣');
    openDeploy();
  },
  data: onNet,
  close: () => {
    if (S.mode !== 'online') return;
    toast('對手已離線', 3000);
    S.mode = null;
    link.close();
    show('home');
  },
});

function openLobby() {
  link.close();
  S.mode = null;
  $('hostCode').value = String(Math.floor(1000 + Math.random() * 9000));
  $('joinCode').value = '';
  $('lobbyStatus').textContent = '';
  show('lobby');
}
backs.lobby = () => { link.close(); show('home'); };

$('hostBtn').addEventListener('click', () => {
  const code = cleanCode($('hostCode').value);
  if (code.length < 3) { toast('密碼至少 3 個字'); return; }
  link.host(code);
});
$('joinBtn').addEventListener('click', () => {
  const code = cleanCode($('joinCode').value);
  if (code.length < 3) { toast('請輸入對手的密碼'); return; }
  link.join(code);
});

function leaveOnline() {
  link.send({ t: 'bye' });
  S.mode = null;
  setTimeout(() => link.close(), 200);
  show('home');
}
$('waitCancel').addEventListener('click', () => { if (confirm('離開房間？')) leaveOnline(); });
backs.wait = () => { if (confirm('離開房間？')) leaveOnline(); };

function hostCheckStart() {
  if (!S.ready[0] || !S.ready[1]) return;
  const combined = overlay(decodeStrokes(S.ready[0].strokes), decodeStrokes(S.ready[1].strokes));
  const armies = [{ team: 0, units: S.ready[0].units }, { team: 1, units: S.ready[1].units }];
  const seed = (Math.random() * 1e9) | 0;
  S.ready = [null, null];
  link.send({ t: 'start', strokes: encodeStrokes(combined), armies });
  startBattle(combined, armies, seed, 'host');
}

function onNet(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'ready':
      if (link.role !== 'host') return;
      S.ready[1] = { units: sanitizeUnits(m.units, 1), strokes: String(m.strokes || '') };
      if (cur === 'wait') hostCheckStart();
      else toast('對手已經準備好了！');
      break;
    case 'start':
      if (link.role !== 'guest') return;
      startBattle(decodeStrokes(m.strokes), m.armies, 1, 'guest');
      break;
    case 'snap':
      if (link.role !== 'guest' || cur !== 'battle' || B.battle) return;
      B.units = unitsFromSnapshot(m.s, B.units);
      B.proj = projFromSnapshot(m.s);
      B.time = m.s.t;
      for (const e of m.e || []) if (e.k === 'crater') B.T.carve(e.x, e.y, e.r);
      B.R.addEvents(m.e || []);
      break;
    case 'end':
      if (link.role !== 'guest' || B.ended) return;
      B.ended = true;
      setTimeout(() => showResult(m.r), 1000);
      break;
    case 'again':
      if (cur === 'battle') toast('對手想再來一局！');
      break;
    case 'bye':
      toast('對手離開了房間', 3000);
      S.mode = null;
      link.close();
      show('home');
      break;
  }
}

// 不信任對方送來的佈陣：限制兵種、數量、位置
function sanitizeUnits(list, team) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_UNITS).filter((u) => u && UNITS[u.type]).map((u) => {
    const x = Number(u.x) || 0.5;
    return { type: u.type, x: team === 0 ? Math.min(0.47, Math.max(0.03, x)) : Math.min(0.97, Math.max(0.53, x)) };
  });
}

/* =========================================================
   說明
   ========================================================= */
{
  const box = $('codex');
  for (const type of UNIT_TYPES) {
    const d = UNITS[type];
    const el = document.createElement('div');
    el.className = 'cx';
    const range = d.ranged || d.lob ? `${d.range} 格` : '近身';
    el.innerHTML = `<canvas></canvas><div><h4>${d.name} <small style="color:var(--ink-soft)">・${d.role}</small></h4>
      <div class="stats"><span>血 <b>${d.hp}</b></span><span>攻 <b>${d.atk}</b></span><span>射程 <b>${range}</b></span><span>爬坡 <b>${d.climb ? '垂直' : d.slope + '°'}</b></span></div>
      <p>${d.trait}</p></div>`;
    box.appendChild(el);
  }
}
backs.help = () => show('home');
const helpObserver = new MutationObserver(() => {
  if (!$('help').classList.contains('on')) return;
  $('codex').querySelectorAll('canvas').forEach((c, i) => unitIcon(c, UNIT_TYPES[i], i % 2));
});
helpObserver.observe($('help'), { attributes: true, attributeFilter: ['class'] });

/* =========================================================
   開始
   ========================================================= */
startHome();

// 測試用（開發時可在主控台使用）
window.__paperArmy = { S, B, home, Terrain, Battle, strokesFromImage, prepareImage, demoStrokes, startBattle, adj };
