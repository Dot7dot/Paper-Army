// 兵種設定
// hp 血量、atk 攻擊、cd 攻擊間隔（秒）、range 攻擊距離（格）、speed 速度（格/秒）
// slope 能爬的最大坡度（度）、h 身高（格）

export const UNITS = {
  sword: {
    name: '劍士', hp: 100, atk: 12, cd: 0.8, range: 8, speed: 14, slope: 50, h: 13,
    role: '近戰', tip: '平衡型', trait: '什麼地形都還算能應付，最穩定的主力。',
  },
  roller: {
    name: '滾滾', hp: 90, atk: 10, cd: 0.7, range: 8, speed: 15, slope: 45, h: 11,
    role: '近戰', tip: '愛圓弧', trait: '站在圓滑的弧面或青苔上：攻擊 ×2、速度 ×1.5。',
  },
  shield: {
    name: '盾衛', hp: 170, atk: 7, cd: 1.0, range: 8, speed: 11, slope: 45, h: 13,
    role: '防守', tip: '尖角立盾', trait: '碰到尖角會停下立起大盾：不怕尖刺、受到傷害 -70%，擋住敵人和箭。',
  },
  heavy: {
    name: '重甲', hp: 280, atk: 26, cd: 1.3, range: 9, speed: 8, slope: 25, h: 15,
    role: '近戰', tip: '怕斜坡', trait: '血厚攻擊高，但坡度超過 25° 就走不上去。',
  },
  archer: {
    name: '弓手', hp: 60, atk: 9, cd: 1.4, range: 80, speed: 12, slope: 45, h: 13, ranged: true,
    role: '遠程', tip: '高處更強', trait: '站得比敵人高，射程和傷害都會提升；箭會被地形擋住。',
  },
  gecko: {
    name: '壁虎', hp: 80, atk: 8, cd: 0.5, range: 7, speed: 20, slope: 89, h: 9, climb: true,
    role: '突襲', tip: '爬牆', trait: '可以直接爬上垂直的牆、爬下來也不會摔傷，速度快但比較脆弱。',
  },
  herb: {
    name: '草藥師', hp: 70, atk: 5, cd: 1.0, range: 7, speed: 12, slope: 45, h: 13, heal: 8,
    role: '支援', tip: '治療', trait: '治療附近受傷的隊友；站在青苔上治療量加倍。',
  },
  bomber: {
    name: '爆破兵', hp: 70, atk: 24, cd: 2.6, range: 76, speed: 10, slope: 40, h: 13, lob: true,
    role: '遠程', tip: '炸地形', trait: '丟炸彈越過障礙，爆炸會把地形炸出坑；炸彈掉進水裡會熄火。',
  },
};

export const UNIT_TYPES = Object.keys(UNITS);

// 地形效果說明（圖鑑、拍照前說明用）
export const TERRAIN_HELP = [
  { key: 'line', name: '線條', desc: '畫的線就是地面。線碰到紙的下緣、或是封閉圖形，裡面會填滿變成實心的山。' },
  { key: 'moss', name: '圓形 → 青苔', desc: '畫一個圓，上面會長青苔。站在青苔上每秒回血。' },
  { key: 'thorn', name: '尖角 → 尖刺', desc: '往上突出的尖角會長出尖刺，碰到會受傷。盾衛會在這裡立盾。' },
  { key: 'water', name: '凹槽 → 水窪', desc: '像碗一樣的凹槽會積水，走進去速度變慢，炸彈會熄火。' },
  { key: 'mush', name: '小圓點 → 彈跳蘑菇', desc: '塗一個實心小圓點，會變成蘑菇，把踩到的兵彈上天。' },
  { key: 'round', name: '圓滑弧面', desc: '彎彎的山丘、圓弧是滾滾的主場，攻擊翻倍。' },
  { key: 'slope', name: '陡坡、牆', desc: '太陡的坡有些兵爬不上去；從高處掉下來會摔傷。' },
];
