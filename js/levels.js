// 單人闖關：每關固定的敵軍（右邊），玩家在左邊佈陣，再畫地形來破關
// x 是 0~1 的水平位置（敵人都在右半邊）

export const LEVELS = [
  {
    name: '初陣',
    slots: 3,
    roster: ['sword', 'archer'],
    enemies: [{ type: 'sword', x: 0.7 }, { type: 'sword', x: 0.8 }, { type: 'sword', x: 0.9 }],
    hint: '先隨便畫幾座山丘試試看！弓手站在山頂上射得更遠。',
  },
  {
    name: '鐵甲來襲',
    slots: 3,
    roster: ['sword', 'archer', 'heavy'],
    enemies: [{ type: 'heavy', x: 0.72 }, { type: 'heavy', x: 0.86 }, { type: 'archer', x: 0.94 }],
    hint: '重甲爬不上超過 25° 的坡。在中間畫一座陡峭的山擋住他們，讓弓手從後面射。',
  },
  {
    name: '滾滾向前',
    slots: 4,
    roster: ['sword', 'archer', 'heavy', 'roller'],
    enemies: [{ type: 'sword', x: 0.62 }, { type: 'sword', x: 0.7 }, { type: 'archer', x: 0.84 }, { type: 'archer', x: 0.92 }],
    hint: '畫圓形或彎彎的山丘，滾滾在圓滑面上攻擊翻倍！',
  },
  {
    name: '箭雨',
    slots: 4,
    roster: ['sword', 'archer', 'heavy', 'roller', 'shield'],
    enemies: [{ type: 'archer', x: 0.66 }, { type: 'archer', x: 0.74 }, { type: 'archer', x: 0.82 }, { type: 'archer', x: 0.9 }, { type: 'sword', x: 0.6 }],
    hint: '畫一個尖角，盾衛碰到會立起大盾，幫隊友擋箭。地形也能擋箭喔。',
  },
  {
    name: '青苔谷',
    slots: 4,
    roster: ['sword', 'archer', 'heavy', 'roller', 'shield', 'herb'],
    enemies: [{ type: 'heavy', x: 0.64 }, { type: 'sword', x: 0.72 }, { type: 'sword', x: 0.78 }, { type: 'bomber', x: 0.9 }],
    hint: '在自己這邊畫一個圓，上面長的青苔可以補血；草藥師站在青苔上治療加倍。',
  },
  {
    name: '城牆',
    slots: 5,
    roster: ['sword', 'archer', 'heavy', 'roller', 'shield', 'herb', 'gecko'],
    enemies: [{ type: 'shield', x: 0.6 }, { type: 'archer', x: 0.82 }, { type: 'archer', x: 0.88 }, { type: 'archer', x: 0.94 }, { type: 'heavy', x: 0.7 }],
    hint: '在敵人前面畫一道垂直的牆，只有壁虎爬得上去，直接偷襲後排弓手！',
  },
  {
    name: '爆破專家',
    slots: 5,
    roster: ['sword', 'archer', 'heavy', 'roller', 'shield', 'herb', 'gecko', 'bomber'],
    enemies: [{ type: 'heavy', x: 0.62 }, { type: 'heavy', x: 0.7 }, { type: 'shield', x: 0.66 }, { type: 'herb', x: 0.86 }, { type: 'archer', x: 0.92 }],
    hint: '爆破兵的炸彈會炸開地形。小心別在他前面畫水窪，炸彈會熄火。',
  },
  {
    name: '紙上決戰',
    slots: 5,
    roster: ['sword', 'archer', 'heavy', 'roller', 'shield', 'herb', 'gecko', 'bomber'],
    enemies: [
      { type: 'heavy', x: 0.6 }, { type: 'roller', x: 0.66 }, { type: 'sword', x: 0.72 },
      { type: 'herb', x: 0.8 }, { type: 'bomber', x: 0.88 }, { type: 'archer', x: 0.94 },
    ],
    hint: '最終關：敵人比你多一隻。善用每一種地形機關吧！',
  },
];
