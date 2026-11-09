// 雙人連線：用 PeerJS（WebRTC 點對點）；兩人輸入同一組密碼就能連上
// 主機 = 建立房間的人（藍隊、左邊），負責跑戰鬥模擬並把畫面同步給對方

const PREFIX = 'paper-army-v1-';

export function cleanCode(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
}

export class Link {
  constructor(handlers) {
    this.h = handlers; // { status(msg), open(), data(msg), close(), error(msg) }
    this.peer = null;
    this.conn = null;
    this.role = null;
  }

  get ready() { return !!(this.conn && this.conn.open); }

  ensureLib() {
    if (!window.Peer) {
      this.h.error('連線元件載入失敗，請確認網路後重新整理頁面。');
      return false;
    }
    return true;
  }

  host(code) {
    if (!this.ensureLib()) return;
    this.close();
    this.role = 'host';
    this.h.status('建立房間中…');
    const peer = new window.Peer(PREFIX + code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => this.h.status(`房間「${code}」已建立，請對手輸入相同密碼加入…`));
    peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) { conn.on('open', () => conn.close()); return; }
      this.wire(conn);
    });
    peer.on('error', (e) => this.h.error(
      e.type === 'unavailable-id' ? '這組密碼已經有人在用，請換一組。' :
        e.type === 'network' || e.type === 'server-error' ? '連不上配對伺服器，請檢查網路。' :
          '連線錯誤（' + e.type + '）'));
    peer.on('disconnected', () => { if (!this.conn) peer.reconnect(); });
  }

  join(code) {
    if (!this.ensureLib()) return;
    this.close();
    this.role = 'guest';
    this.h.status('尋找房間中…');
    const peer = new window.Peer({ debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      this.wire(conn);
      setTimeout(() => { if (!this.ready && this.peer === peer) this.h.error('連不上對手，請確認密碼，或請對手重新建立房間。'); }, 15000);
    });
    peer.on('error', (e) => this.h.error(
      e.type === 'peer-unavailable' ? '找不到這個房間，請確認密碼是否正確。' :
        e.type === 'network' || e.type === 'server-error' ? '連不上配對伺服器，請檢查網路。' :
          '連線錯誤（' + e.type + '）'));
  }

  wire(conn) {
    this.conn = conn;
    conn.on('open', () => { this.h.status('已連線！'); this.h.open(); });
    conn.on('data', (d) => this.h.data(d));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.h.close(); } });
    conn.on('error', () => {});
  }

  send(msg) {
    if (this.ready) this.conn.send(msg);
  }

  close() {
    const { conn, peer } = this;
    this.conn = null;
    this.peer = null;
    try { conn && conn.close(); } catch { /* ignore */ }
    try { peer && peer.destroy(); } catch { /* ignore */ }
  }
}
