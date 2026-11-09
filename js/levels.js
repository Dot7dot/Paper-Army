// 單人闖關：循序漸進，每一關最多教一個新角色或新地形
//
// teach：這一關新解鎖的角色（unit）與地形機關（terrain），第一次進入時會跳出學習卡
// task：這一關的任務（拿第二顆星），通常就是要你用剛學到的東西
//   s 是戰鬥統計項目（見 sim.js 的 stats），team 0 = 自己、1 = 敵人，n 是門檻
//   特殊：hill（畫出多高的山）、fast（幾秒內獲勝）、alive（至少幾隻存活）
// 敵人的 x 是 0~1 的水平位置（都在右半邊）
//
// 可派出的角色、開放的地形機關會依關卡順序自動累積

export const CHAPTERS = [
  { name: '第一章・紙上練兵', desc: '線條、山坡與高地' },
  { name: '第二章・圓滾滾的山丘', desc: '圓弧與青苔' },
  { name: '第三章・尖刺與盾牌', desc: '尖角的用法' },
  { name: '第四章・水窪與蘑菇', desc: '凹槽、圓點與牆' },
  { name: '第五章・爆破與決戰', desc: '炸開地形，最終決戰' },
];

const RAW = [
  /* ---------- 第一章 ---------- */
  {
    ch: 0, name: '初陣', slots: 2,
    teach: { unit: 'sword', terrain: 'line' },
    enemies: [{ type: 'sword', x: 0.8 }],
    hint: '在紙上畫一座平緩的山（線碰到紙的下緣，下面就會變成實心；太陡的話兵會爬不上去），拍照後按開戰！',
    task: { s: 'hill', n: 20, text: '畫一座比士兵高的山' },
  },
  {
    ch: 0, name: '居高臨下', slots: 3,
    teach: { unit: 'archer' },
    enemies: [{ type: 'sword', x: 0.7 }, { type: 'sword', x: 0.82 }, { type: 'sword', x: 0.92 }],
    hint: '在你這邊畫一座平頂的高台，把弓手放在上面。站得比敵人高，射得更遠更痛。',
    task: { s: 'high', team: 0, n: 3, text: '弓手從高處射箭 3 次' },
  },
  {
    ch: 0, name: '重甲出擊', slots: 3,
    teach: { unit: 'heavy', terrain: 'slope' },
    enemies: [{ type: 'sword', x: 0.68 }, { type: 'sword', x: 0.8 }, { type: 'archer', x: 0.92 }],
    hint: '重甲很強，但爬不上超過 25° 的坡。這關把地形畫平一點，讓他一路衝過去！',
    task: { s: 'fast', n: 35, text: '35 秒內獲勝' },
  },
  {
    ch: 0, name: '陡坡防線', slots: 3,
    enemies: [{ type: 'heavy', x: 0.66 }, { type: 'heavy', x: 0.8 }, { type: 'archer', x: 0.93 }],
    hint: '這次換敵人派出重甲。在中間畫一座陡峭的山擋住他們，再讓弓手從後面射。',
    task: { s: 'blocked', team: 1, n: 2, text: '讓 2 隻敵人被陡坡擋住' },
  },
  {
    ch: 0, name: '第一章考驗', slots: 4,
    enemies: [{ type: 'heavy', x: 0.62 }, { type: 'sword', x: 0.7 }, { type: 'sword', x: 0.78 }, { type: 'archer', x: 0.88 }, { type: 'archer', x: 0.95 }],
    hint: '敵人比你多一隻。用陡坡擋重甲、用高台讓弓手佔上風。',
    task: { s: 'alive', n: 3, text: '至少 3 隻存活' },
  },

  /* ---------- 第二章 ---------- */
  {
    ch: 1, name: '滾滾登場', slots: 3,
    teach: { unit: 'roller', terrain: 'round' },
    enemies: [{ type: 'sword', x: 0.62 }, { type: 'sword', x: 0.74 }, { type: 'sword', x: 0.86 }],
    hint: '在中間畫一座圓圓的、彎彎的山丘（坡不要太陡），滾滾在弧面上攻擊翻倍！',
    task: { s: 'round', team: 0, n: 3, text: '滾滾在圓弧上攻擊 3 次' },
  },
  {
    ch: 1, name: '青苔', slots: 4,
    teach: { terrain: 'moss' },
    enemies: [{ type: 'sword', x: 0.6 }, { type: 'sword', x: 0.7 }, { type: 'archer', x: 0.84 }, { type: 'archer', x: 0.93 }],
    hint: '在你的兵上方畫一個圓（不要碰到其他線），上面會長青苔，站在上面會慢慢回血。',
    task: { s: 'moss', team: 0, n: 15, text: '在青苔上回復 15 點血' },
  },
  {
    ch: 1, name: '草藥師', slots: 4,
    teach: { unit: 'herb' },
    enemies: [{ type: 'heavy', x: 0.62 }, { type: 'sword', x: 0.72 }, { type: 'sword', x: 0.8 }, { type: 'archer', x: 0.92 }],
    hint: '草藥師會治療附近的隊友，站在青苔上治療量加倍。讓他躲在隊伍後面。',
    task: { s: 'heal', team: 0, n: 60, text: '草藥師治療 60 點血' },
  },
  {
    ch: 1, name: '第二章考驗', slots: 4,
    enemies: [{ type: 'heavy', x: 0.62 }, { type: 'roller', x: 0.7 }, { type: 'herb', x: 0.86 }, { type: 'archer', x: 0.94 }],
    hint: '敵人也有滾滾和草藥師。小心：你畫的圓弧，敵方滾滾一樣能用！',
    task: { s: 'alive', n: 3, text: '至少 3 隻存活' },
  },

  /* ---------- 第三章 ---------- */
  {
    ch: 2, name: '尖刺陷阱', slots: 4,
    teach: { terrain: 'thorn' },
    enemies: [{ type: 'sword', x: 0.6 }, { type: 'sword', x: 0.68 }, { type: 'sword', x: 0.76 }, { type: 'sword', x: 0.84 }],
    hint: '在敵人會走到的地方畫尖尖的山（像 ^），尖角和兩側的陡坡會長刺，靠近的敵人會受傷。',
    task: { s: 'thorn', team: 1, n: 15, text: '敵人被尖刺扎傷 15 點' },
  },
  {
    ch: 2, name: '盾衛', slots: 4,
    teach: { unit: 'shield' },
    enemies: [{ type: 'sword', x: 0.6 }, { type: 'archer', x: 0.76 }, { type: 'archer', x: 0.85 }, { type: 'archer', x: 0.94 }],
    hint: '盾衛碰到尖角會立起大盾，不怕尖刺還能擋箭。在你這邊畫個尖角，讓盾衛在那裡守住。',
    task: { s: 'shield', team: 0, n: 1, text: '讓盾衛在尖角立盾' },
  },
  {
    ch: 2, name: '箭雨', slots: 4,
    enemies: [{ type: 'sword', x: 0.58 }, { type: 'archer', x: 0.7 }, { type: 'archer', x: 0.78 }, { type: 'archer', x: 0.86 }, { type: 'archer', x: 0.94 }],
    hint: '四個弓手！立盾的盾衛擋在前面，後面的隊友就安全了。山也能擋箭。',
    task: { s: 'guard', team: 0, n: 40, text: '立盾的盾衛擋下 40 點傷害' },
  },
  {
    ch: 2, name: '第三章考驗', slots: 5,
    enemies: [{ type: 'shield', x: 0.6 }, { type: 'heavy', x: 0.68 }, { type: 'sword', x: 0.75 }, { type: 'archer', x: 0.86 }, { type: 'archer', x: 0.94 }],
    hint: '敵方盾衛也會在尖角立盾。尖刺要畫在敵人那邊，還是自己這邊？',
    task: { s: 'alive', n: 3, text: '至少 3 隻存活' },
  },

  /* ---------- 第四章 ---------- */
  {
    ch: 3, name: '水窪', slots: 4,
    teach: { terrain: 'water' },
    enemies: [{ type: 'heavy', x: 0.62 }, { type: 'sword', x: 0.7 }, { type: 'sword', x: 0.78 }, { type: 'sword', x: 0.86 }],
    hint: '在中間畫一個碗形的凹槽，會積水。敵人走進去會變慢，你的弓手就能多射幾箭。',
    task: { s: 'wet', team: 1, n: 2, text: '讓 2 隻敵人走進水裡' },
  },
  {
    ch: 3, name: '彈跳蘑菇', slots: 4,
    teach: { terrain: 'mush' },
    enemies: [{ type: 'heavy', x: 0.7 }, { type: 'heavy', x: 0.8 }, { type: 'archer', x: 0.93 }],
    hint: '用筆塗一個實心小圓點，會變成蘑菇。放在你的兵前面，他們會被彈到空中、飛過障礙。',
    task: { s: 'bounce', team: 0, n: 2, text: '用蘑菇彈跳 2 次' },
  },
  {
    ch: 3, name: '壁虎', slots: 4,
    teach: { unit: 'gecko' },
    enemies: [{ type: 'shield', x: 0.6 }, { type: 'archer', x: 0.84 }, { type: 'archer', x: 0.93 }],
    hint: '在敵人前面畫一道垂直的牆，只有壁虎爬得上去，翻過去偷襲後面的弓手！',
    task: { s: 'climb', team: 0, n: 1, text: '讓壁虎爬上牆' },
  },
  {
    ch: 3, name: '第四章考驗', slots: 5,
    enemies: [{ type: 'heavy', x: 0.6 }, { type: 'roller', x: 0.68 }, { type: 'gecko', x: 0.74 }, { type: 'herb', x: 0.86 }, { type: 'archer', x: 0.94 }],
    hint: '敵方壁虎會爬牆，牆擋不住牠。試試水窪和蘑菇。',
    task: { s: 'alive', n: 3, text: '至少 3 隻存活' },
  },

  /* ---------- 第五章 ---------- */
  {
    ch: 4, name: '爆破兵', slots: 4,
    teach: { unit: 'bomber' },
    enemies: [{ type: 'heavy', x: 0.66 }, { type: 'heavy', x: 0.74 }, { type: 'shield', x: 0.62 }, { type: 'archer', x: 0.92 }],
    hint: '爆破兵的炸彈會飛過障礙，爆炸還會把地形炸出坑。用牆擋住敵人，再慢慢炸。',
    task: { s: 'crater', team: 0, n: 2, text: '炸出 2 個坑' },
  },
  {
    ch: 4, name: '滅火', slots: 5,
    enemies: [{ type: 'heavy', x: 0.62 }, { type: 'sword', x: 0.7 }, { type: 'bomber', x: 0.84 }, { type: 'bomber', x: 0.92 }],
    hint: '敵人有兩個爆破兵！在你的兵前面畫水窪，炸彈掉進水裡就會熄火。',
    task: { s: 'fizzle', team: 1, n: 1, text: '讓敵方的炸彈掉進水裡熄火' },
  },
  {
    ch: 4, name: '城牆攻防', slots: 5,
    enemies: [{ type: 'shield', x: 0.58 }, { type: 'heavy', x: 0.66 }, { type: 'archer', x: 0.82 }, { type: 'archer', x: 0.88 }, { type: 'herb', x: 0.94 }],
    hint: '敵人躲在後面射箭。壁虎爬牆、爆破兵炸牆、蘑菇彈過去，選一個你喜歡的方法。',
    task: { s: 'fast', n: 45, text: '45 秒內獲勝' },
  },
  {
    ch: 4, name: '紙上決戰', slots: 5,
    enemies: [
      { type: 'heavy', x: 0.6 }, { type: 'roller', x: 0.66 }, { type: 'shield', x: 0.72 },
      { type: 'herb', x: 0.8 }, { type: 'bomber', x: 0.88 }, { type: 'archer', x: 0.95 },
    ],
    hint: '最終關：敵人比你多一隻，什麼兵種都有。善用學過的每一種地形！',
    task: { s: 'alive', n: 3, text: '至少 3 隻存活' },
  },
];

// 依順序累積：可派出的角色、開放的地形機關
export const LEVELS = (() => {
  const roster = [], mechs = [];
  return RAW.map((L) => {
    if (L.teach?.unit && !roster.includes(L.teach.unit)) roster.push(L.teach.unit);
    if (L.teach?.terrain && !mechs.includes(L.teach.terrain)) mechs.push(L.teach.terrain);
    return { ...L, roster: roster.slice(), mechs: mechs.slice() };
  });
})();

// 任務是否完成
export function taskDone(task, stats, result, terrain) {
  if (!task) return false;
  switch (task.s) {
    case 'hill': return terrain.maxHill() >= task.n;
    case 'fast': return result.winner === 0 && result.time <= task.n;
    case 'alive': return result.alive[0] >= task.n;
    default: return (stats[task.team ?? 0][task.s] || 0) >= task.n;
  }
}

// 任務進度（結果畫面顯示用）
export function taskProgress(task, stats, result, terrain) {
  switch (task.s) {
    case 'hill': return `${terrain.maxHill()} / ${task.n} 格高`;
    case 'fast': return result.winner === 0 ? `${Math.ceil(result.time)} 秒` : '沒有獲勝';
    case 'alive': return `${result.alive[0]} 隻`;
    default: return `${Math.floor(stats[task.team ?? 0][task.s] || 0)} / ${task.n}`;
  }
}
