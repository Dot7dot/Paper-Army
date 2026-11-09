// 戰鬥模擬：固定時間步長，主機（或單機）執行，畫面只負責畫
import { GW, GH, F } from './terrain.js';
import { UNITS, UNIT_TYPES } from './units.js';

export const DT = 1 / 30;
export const DURATION = 60;
const G = 160;              // 重力（格/秒²）
const FALL_SAFE = 40;       // 掉超過這個高度會摔傷
const ARROW = { v: 125, g: 60 };
const BOMB = { v: 92, g: 110, r: 16, carve: 7.5 };
const STATES = ['fall', 'walk', 'fight', 'blocked', 'climb', 'shield', 'idle', 'dead', 'wait'];

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Battle {
  // armies: [{ team: 0|1, units: [{ type, x(0~1) }] }]
  constructor(terrain, armies, seed = 1) {
    this.T = terrain;
    this.time = 0;
    this.units = [];
    this.proj = [];
    this.events = [];
    this.over = false;
    this.result = null;
    this.rng = mulberry32(seed);
    let id = 1;
    for (const army of armies) {
      for (const p of army.units) {
        const d = UNITS[p.type];
        this.units.push({
          id: id++, team: army.team, type: p.type, d,
          x: clamp(p.x * GW, 3, GW - 3), y: -14 - this.rng() * 24,
          vx: 0, vy: 0, hp: d.hp, max: d.hp,
          cd: 0.3 + this.rng() * 0.6, state: 'fall', face: army.team === 0 ? 1 : -1,
          ground: false, drop: true, minY: -40, round: false, wet: false, moss: false,
          anim: this.rng() * 10, said: {}, thornAcc: 0, bounceCD: 0, aim: 0, scan: 0,
          climbCD: 0, deadT: 0, hitT: 0,
        });
      }
    }
  }

  solid(x, y) { return this.T.solidAt(x, y); }

  emit(e) { this.events.push(e); }

  say(u, s, color = '#333', every = 3) {
    if (this.time - (u.said[s] ?? -99) < every) return;
    u.said[s] = this.time;
    this.emit({ k: 'txt', x: u.x, y: u.y - u.d.h - 6, s, c: color });
  }

  alive(team) { return this.units.filter((u) => u.team === team && u.state !== 'dead'); }

  step() {
    if (this.over) return;
    const dt = DT;
    this.time += dt;
    for (const u of this.units) this.updateUnit(u, dt);
    this.updateProjectiles(dt);
    const a0 = this.alive(0).length, a1 = this.alive(1).length;
    if (this.time >= DURATION || (this.time > 1 && (a0 === 0 || a1 === 0))) {
      this.over = true;
      this.result = { alive: [a0, a1], winner: a0 > a1 ? 0 : a1 > a0 ? 1 : -1, time: this.time };
    }
  }

  /* ---------------- 地形查詢 ---------------- */

  // 走到 col 欄後腳下的地面：{y} / {wall} / {drop}
  groundAt(col, fy, up, down, h) {
    if (col < 1 || col >= GW - 1) return { wall: true };
    let y;
    if (this.solid(col, fy - 1)) {
      let k = 1;
      while (k <= up && this.solid(col, fy - 1 - k)) k++;
      if (k > up) return { wall: true };
      y = fy - k;
    } else if (this.solid(col, fy)) {
      y = fy;
    } else {
      for (let k = 1; k <= down; k++) if (this.solid(col, fy + k)) { y = fy + k; break; }
      if (y === undefined) return { drop: true };
    }
    // 頭上要有空間
    if (h) for (let r = y - 2; r >= y - h + 2; r--) if (this.solid(col, r)) return { wall: true, low: true };
    return { y };
  }

  // 前方的坡度（上升格數 / 水平格數），牆 = Infinity
  // 線條和地面接合處常有 2~3 格的小台階，不算進坡度裡
  slopeAhead(u, dir) {
    let fy = u.y, col = Math.floor(u.x);
    const rise = [0];
    for (let k = 1; k <= 8; k++) {
      const g = this.groundAt(col + dir * k, fy, 10, 10, 0);
      if (g.wall) { if (k <= 2) return Infinity; break; }
      if (g.drop) break;
      fy = g.y;
      rise.push(u.y - fy);
    }
    const r2 = rise[Math.min(2, rise.length - 1)];
    let rate = Math.max(0, (r2 - 3) / 2);
    for (const k of [6, 8]) if (rise.length > k) rate = Math.max(rate, (rise[k] - r2) / (k - 2));
    if (rise.length > 3 && rise.length <= 6) rate = Math.max(rate, (rise[rise.length - 1] - r2) / Math.max(1, rise.length - 3));
    return rate;
  }

  dropDepth(col, fy) {
    let k = 0;
    while (k < 60 && !this.solid(col, fy + k)) k++;
    return k;
  }

  bodyFree(x, y, h) {
    const col = Math.floor(x);
    for (let r = Math.floor(y - h); r < Math.floor(y); r++) if (this.solid(col, r)) return false;
    return true;
  }

  /* ---------------- 單位 ---------------- */

  updateUnit(u, dt) {
    if (u.state === 'dead') { u.deadT += dt; return; }
    u.anim += dt;
    u.hitT = Math.max(0, u.hitT - dt);
    u.bounceCD -= dt;
    u.climbCD -= dt;
    u.cd -= dt;
    u.aim -= dt;
    u.scan -= dt;
    u.swing = Math.max(0, (u.swing || 0) - dt);

    if (u.state === 'climb') {
      this.climb(u, dt);
      if (u.state !== 'climb' && !u.ground) return;
    }
    else if (!u.ground) { this.fall(u, dt); return; }
    else {
      const col = Math.floor(u.x);
      if (!this.solid(col, u.y)) { u.ground = false; u.minY = u.y; if (u.state !== 'shield') u.state = 'fall'; return; }
      let k = 0;
      while (k < u.d.h && this.solid(col, u.y - 1)) { u.y--; k++; }
    }
    if (u.state === 'dead') return;

    this.terrainEffects(u, dt);
    if (u.state === 'dead' || (!u.ground && u.state !== 'climb')) return;
    this.think(u, dt);
  }

  fall(u, dt) {
    u.vy = Math.min(u.vy + G * dt, 230);
    if (u.vx) {
      const nx = u.x + u.vx * dt;
      if (nx > 1 && nx < GW - 1 && this.bodyFree(nx, u.y, u.d.h)) u.x = nx;
      else u.vx = 0;
      u.vx *= 1 - 1.2 * dt;
    }
    const ny = u.y + u.vy * dt;
    const col = Math.floor(u.x);
    if (u.vy > 0) {
      for (let r = Math.max(0, Math.ceil(u.y)); r <= Math.floor(ny); r++) {
        if (this.solid(col, r)) { this.land(u, r); return; }
      }
      u.y = ny;
    } else {
      const head = Math.floor(ny - u.d.h);
      if (head >= 0 && this.solid(col, head)) { u.vy = 0; return; }
      u.y = ny;
      u.minY = Math.min(u.minY, u.y);
    }
  }

  land(u, r) {
    const fall = r - u.minY;
    u.y = r; u.vy = 0; u.vx = 0; u.ground = true;
    if (u.state === 'fall') u.state = 'walk';
    this.emit({ k: 'dust', x: u.x, y: r, n: u.drop ? 8 : 4 });
    if (!u.drop && fall > FALL_SAFE) {
      this.damage(u, (fall - FALL_SAFE) * 1.5, null);
      this.say(u, '摔傷!', '#b04020', 1);
    }
    u.drop = false;
  }

  climb(u, dt) {
    const col = Math.floor(u.x) + u.face;
    u.y -= u.d.speed * 0.7 * dt;
    const fy = Math.round(u.y);
    const g = this.groundAt(col, fy, 1, 2, u.d.h);
    if (!g.wall && !g.drop) { // 爬到頂了
      u.x = col + 0.5; u.y = g.y; u.state = 'walk'; u.ground = true;
      return;
    }
    const ceiling = this.solid(Math.floor(u.x), Math.floor(u.y - u.d.h));
    const lost = !this.solid(col, fy - 1) && !this.solid(col, fy);
    if (ceiling || lost || u.y < 2) {
      u.state = 'fall'; u.ground = false; u.minY = u.y; u.climbCD = 2;
    }
  }

  terrainEffects(u, dt) {
    const T = this.T;
    const col = Math.floor(u.x), y = u.y;
    if (u.state === 'climb') { u.round = u.moss = false; u.wet = false; return; }
    const under = T.flagAt(col, y) | T.flagAt(col - 1, y) | T.flagAt(col + 1, y);
    u.round = !!(under & (F.ROUND | F.MOSS));
    u.moss = !!(under & F.MOSS);
    u.wet = !!((T.flagAt(col, y - 1) | T.flagAt(col, y - 3)) & F.WATER);

    if (u.moss && u.hp < u.max) {
      u.hp = Math.min(u.max, u.hp + 5 * dt);
      if (Math.floor(u.anim * 2) !== Math.floor((u.anim - dt) * 2)) this.emit({ k: 'heal', x: u.x, y: u.y - u.d.h - 3, v: 0 });
    }

    // 尖刺
    let thorn = false;
    for (let dx = -1; dx <= 1 && !thorn; dx++) for (let dy = -1; dy <= 1; dy++) if (T.flagAt(col + dx, y + dy) & F.THORN) { thorn = true; break; }
    for (let k = 1; k <= 3 && !thorn; k++) {
      for (let r = y - 1; r >= y - u.d.h / 2; r--) if (T.flagAt(col + u.face * k, r) & F.THORN) { thorn = true; break; }
    }
    if (thorn) {
      if (u.type === 'shield' && u.state !== 'shield') {
        u.state = 'shield';
        this.say(u, '立盾!', '#2a4', 99);
        this.emit({ k: 'dust', x: u.x + u.face * 3, y, n: 6 });
      }
      if (u.state !== 'shield') {
        u.thornAcc += 14 * dt;
        u.hp -= 14 * dt;
        u.hitT = 0.1;
        if (u.thornAcc >= 7) {
          this.emit({ k: 'dmg', x: u.x, y: u.y - u.d.h - 2, v: Math.round(u.thornAcc), c: '#a33' });
          u.thornAcc = 0;
          this.say(u, '好痛!', '#a33', 4);
        }
        if (u.hp <= 0) { this.die(u); return; }
      }
    }

    // 蘑菇
    if (u.bounceCD <= 0 && u.state !== 'shield') {
      let m = T.flagAt(col, y) & F.MUSH;
      for (let k = 1; k <= 5 && !m; k++) for (let r = y - 1; r >= y - 5 && !m; r--) m = T.flagAt(col + u.face * k, r) & F.MUSH;
      if (m) {
        u.vy = -105; u.vx = u.face * 38; u.ground = false; u.minY = u.y; u.state = 'fall'; u.bounceCD = 0.5;
        this.emit({ k: 'boing', x: u.x, y });
        this.say(u, '彈!', '#c33', 1);
      }
    }
  }

  think(u, dt) {
    const d = u.d;
    const foes = this.units.filter((f) => f.team !== u.team && f.state !== 'dead');
    if (!foes.length) { if (u.state !== 'shield') u.state = 'idle'; return; }
    let near = null, nd = 1e9;
    for (const f of foes) {
      const dist = Math.hypot(f.x - u.x, (f.y - f.d.h / 2) - (u.y - d.h / 2));
      if (dist < nd) { nd = dist; near = f; }
    }
    if (u.state !== 'shield' && u.state !== 'climb') u.face = Math.sign(near.x - u.x) || u.face;
    if (u.state === 'climb') return;

    // 治療
    if (d.heal && u.cd <= 0) {
      let best = null, br = 1;
      for (const a of this.units) {
        if (a.team !== u.team || a.state === 'dead' || a.hp >= a.max - 1) continue;
        if (Math.hypot(a.x - u.x, a.y - u.y) > 45) continue;
        const ratio = a.hp / a.max;
        if (ratio < br) { br = ratio; best = a; }
      }
      if (best) {
        const amt = d.heal * (u.moss ? 2 : 1);
        best.hp = Math.min(best.max, best.hp + amt);
        u.cd = d.cd;
        this.emit({ k: 'heal', x: best.x, y: best.y - best.d.h - 3, v: Math.round(amt), from: [u.x, u.y - d.h] });
      }
    }

    // 遠程
    if ((d.ranged || d.lob) && u.state !== 'shield') {
      if (u.cd <= 0 && u.scan <= 0) {
        u.scan = 0.2;
        if (this.shoot(u, foes)) { u.cd = d.cd; u.aim = 1.8; }
      }
      if (u.aim > 0) { u.state = 'fight'; return; }
      if (this.meleeTarget(u, foes)) { u.state = 'fight'; return; }
      this.walk(u, dt, foes);
      return;
    }

    // 近戰
    const t = this.meleeTarget(u, foes);
    if (t) {
      if (u.state !== 'shield') u.state = 'fight';
      if (u.cd <= 0) {
        let atk = d.atk;
        if (u.type === 'roller' && u.round) atk *= 2;
        this.damage(t, atk, u);
        u.cd = d.cd;
        u.swing = 0.2;
      }
      return;
    }
    if (u.state === 'shield') return;
    if (d.heal && nd < 34) { u.state = 'wait'; return; }
    this.walk(u, dt, foes);
  }

  meleeTarget(u, foes) {
    let best = null, bd = 1e9;
    for (const f of foes) {
      const dx = Math.abs(f.x - u.x);
      const reach = u.d.range + (f.state === 'shield' ? 4 : 2);
      if (dx > reach || Math.abs(f.y - u.y) > 10) continue;
      const mx = (u.x + f.x) / 2, my = Math.min(u.y, f.y) - 5;
      if (this.solid(mx, my)) continue;
      if (dx < bd) { bd = dx; best = f; }
    }
    return best;
  }

  walk(u, dt, foes) {
    const d = u.d, dir = u.face;
    // 前面有隊友在打架就排隊；敵人擋路就停下
    for (const a of this.units) {
      if (a === u || a.state === 'dead') continue;
      const ahead = (a.x - u.x) * dir;
      if (ahead <= 0 || Math.abs(a.y - u.y) > 9) continue;
      if (a.team === u.team && a.state === 'fight' && ahead < 6) { u.state = 'wait'; return; }
      if (a.team !== u.team && ahead < (a.state === 'shield' ? 7 : 4)) { u.state = 'wait'; return; }
    }
    let sp = d.speed;
    if (u.type === 'roller' && u.round) sp *= 1.5;
    if (u.wet) sp *= 0.5;
    const nx = u.x + dir * sp * dt;
    if (nx < 2 || nx > GW - 2) { u.state = 'idle'; return; }
    const col = Math.floor(u.x), ncol = Math.floor(nx);
    if (ncol === col) { u.x = nx; u.state = 'walk'; return; }
    const g = this.groundAt(ncol, u.y, 14, 3, d.h);
    const maxRate = Math.tan((d.slope * Math.PI) / 180);
    const rate = g.wall ? Infinity : !g.drop && g.y < u.y ? this.slopeAhead(u, dir) : 0;
    if (g.wall || rate > maxRate + 0.02) {
      if (d.climb && u.climbCD <= 0 && !g.low) { u.state = 'climb'; this.say(u, '爬!', '#2a6', 3); return; }
      u.state = 'blocked';
      this.say(u, g.low ? '太矮了' : (rate === Infinity ? '是牆!' : '太陡了!'), '#666', 5);
      return;
    }
    if (g.drop) {
      // 遠程兵喜歡待在高處，不往下跳
      if ((d.ranged || d.lob) && this.dropDepth(ncol, u.y) > 12 &&
        foes.some((f) => Math.abs(f.x - u.x) < d.range * 1.3)) { u.state = 'wait'; return; }
      u.x = nx; u.ground = false; u.minY = u.y; u.state = 'fall'; return;
    }
    u.x = nx; u.y = g.y; u.state = 'walk';
  }

  /* ---------------- 投射物 ---------------- */

  shoot(u, foes) {
    const d = u.d;
    const ox = u.x + u.face * 2, oy = u.y - d.h * 0.75;
    const P = d.lob ? BOMB : ARROW;
    const list = foes
      .map((f) => ({ f, dist: Math.hypot(f.x - ox, f.y - f.d.h / 2 - oy) }))
      .sort((a, b) => a.dist - b.dist);
    for (const { f, dist } of list) {
      const adv = d.ranged ? clamp(f.y - u.y, 0, 60) : 0; // 比敵人高多少
      const range = d.range + adv * 0.8;
      if (dist > range) break;
      const tx = f.x, ty = f.y - f.d.h * 0.5;
      const sols = ballistic(tx - ox, ty - oy, P.v, P.g);
      if (!sols) continue;
      const order = d.lob ? [sols[1], sols[0]] : sols;
      for (const [vx, vy] of order) {
        if (!this.pathClear(ox, oy, vx, vy, P.g, tx, ty, d.lob ? 12 : 3)) continue;
        const dmg = d.atk * (d.ranged ? 1 + adv / 100 : 1);
        this.proj.push({ kind: d.lob ? 1 : 0, x: ox, y: oy, vx, vy, g: P.g, team: u.team, dmg, t: 0 });
        u.face = Math.sign(vx) || u.face;
        u.swing = 0.25;
        if (adv > 15 && d.ranged) this.say(u, '居高臨下!', '#246', 6);
        return true;
      }
    }
    return false;
  }

  pathClear(x, y, vx, vy, g, tx, ty, near) {
    const h = 1 / 60;
    for (let i = 0; i < 420; i++) {
      vy += g * h; x += vx * h; y += vy * h;
      if (Math.hypot(x - tx, y - ty) < 3) return true;
      if (x < 0 || x >= GW || y >= GH) return false;
      if (this.solid(x, y)) return Math.hypot(x - tx, y - ty) < near;
    }
    return false;
  }

  updateProjectiles(dt) {
    const T = this.T;
    const out = [];
    for (const p of this.proj) {
      let alive = true;
      for (let s = 0; s < 3 && alive; s++) {
        const h = dt / 3;
        p.vy += p.g * h; p.x += p.vx * h; p.y += p.vy * h; p.t += h;
        if (p.x < 0 || p.x >= GW || p.y >= GH || p.t > 5) { alive = false; break; }
        if (p.kind === 1 && (T.flagAt(p.x, p.y) & F.WATER)) {
          this.emit({ k: 'fizzle', x: p.x, y: p.y });
          alive = false; break;
        }
        for (const e of this.units) {
          if (e.team === p.team || e.state === 'dead') continue;
          const hw = e.state === 'shield' ? 5 : 3.2;
          if (Math.abs(p.x - e.x) <= hw && p.y >= e.y - e.d.h && p.y <= e.y + 0.5) {
            if (p.kind === 1) this.explode(p);
            else this.damage(e, p.dmg, null);
            alive = false; break;
          }
        }
        if (!alive) break;
        if (this.solid(p.x, p.y)) {
          if (p.kind === 1) this.explode(p);
          else this.emit({ k: 'spark', x: p.x, y: p.y });
          alive = false;
        }
      }
      if (alive) out.push(p);
    }
    this.proj = out;
  }

  explode(p) {
    this.emit({ k: 'boom', x: p.x, y: p.y, r: BOMB.r });
    for (const e of this.units) {
      if (e.team === p.team || e.state === 'dead') continue;
      const dist = Math.hypot(e.x - p.x, e.y - e.d.h / 2 - p.y);
      if (dist > BOMB.r) continue;
      this.damage(e, p.dmg * (1 - (0.5 * dist) / BOMB.r), null);
      if (e.state !== 'dead' && e.state !== 'shield') {
        e.vx = (Math.sign(e.x - p.x) || 1) * 40; e.vy = -55;
        e.ground = false; e.minY = e.y; e.state = 'fall';
      }
    }
    const cx = Math.round(p.x * 2) / 2, cy = Math.round(p.y * 2) / 2;
    if (this.T.carve(cx, cy, BOMB.carve)) this.emit({ k: 'crater', x: cx, y: cy, r: BOMB.carve });
  }

  damage(t, amt, src) {
    if (t.state === 'dead') return;
    if (t.state === 'shield') amt *= 0.3;
    t.hp -= amt;
    t.hitT = 0.15;
    this.emit({ k: 'dmg', x: t.x, y: t.y - t.d.h - 2, v: Math.max(1, Math.round(amt)), c: t.team === 0 ? '#1d4fc4' : '#c4301d' });
    if (src && src.type === 'roller' && src.round) this.say(src, '滾滾滾!', '#c80', 3);
    if (t.hp <= 0) this.die(t);
  }

  die(u) {
    u.hp = 0;
    u.state = 'dead';
    u.deadT = 0;
    this.emit({ k: 'die', x: u.x, y: u.y - u.d.h / 2, team: u.team });
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /* ---------------- 網路同步 ---------------- */

  snapshot() {
    return {
      t: Math.round(this.time * 100) / 100,
      u: this.units.map((u) => [
        u.id, UNIT_TYPES.indexOf(u.type), u.team,
        Math.round(u.x * 10), Math.round(u.y * 10), Math.ceil(u.hp), u.max,
        STATES.indexOf(u.state), u.face,
        (u.round ? 1 : 0) | (u.wet ? 2 : 0) | (u.ground ? 4 : 0) | (u.hitT > 0 ? 8 : 0) | ((u.swing || 0) > 0 ? 16 : 0),
        Math.round(u.deadT * 10),
      ]),
      p: this.proj.map((p) => [p.kind, Math.round(p.x * 10), Math.round(p.y * 10), Math.round(p.vx), Math.round(p.vy)]),
    };
  }
}

// 從快照還原成畫面用的單位
export function unitsFromSnapshot(snap, prev) {
  const old = new Map((prev || []).map((u) => [u.id, u]));
  return snap.u.map((a) => {
    const type = UNIT_TYPES[a[1]];
    const o = old.get(a[0]);
    const u = o || { id: a[0], type, team: a[2], d: UNITS[type], anim: Math.random() * 10, x: a[3] / 10, y: a[4] / 10 };
    u.tx = a[3] / 10; u.ty = a[4] / 10;
    if (!o || Math.abs(u.tx - u.x) > 20 || Math.abs(u.ty - u.y) > 30) { u.x = u.tx; u.y = u.ty; }
    u.hp = a[5]; u.max = a[6]; u.state = STATES[a[7]]; u.face = a[8];
    u.round = !!(a[9] & 1); u.wet = !!(a[9] & 2); u.ground = !!(a[9] & 4);
    u.hitT = a[9] & 8 ? 0.1 : 0; u.swing = a[9] & 16 ? 0.15 : 0;
    u.deadT = a[10] / 10;
    return u;
  });
}

export function projFromSnapshot(snap) {
  return snap.p.map((a) => ({ kind: a[0], x: a[1] / 10, y: a[2] / 10, vx: a[3], vy: a[4] }));
}

// 拋物線：回傳 [低角度, 高角度] 的速度向量（y 向下）
function ballistic(dx, dy, v, g) {
  const X = Math.abs(dx), Y = -dy;
  if (X < 0.5) return null;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * X * X + 2 * Y * v2);
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const out = [];
  for (const tan of [(v2 - s) / (g * X), (v2 + s) / (g * X)]) {
    const th = Math.atan(tan);
    out.push([Math.sign(dx) * v * Math.cos(th), -v * Math.sin(th)]);
  }
  return out;
}
