// Mesin kantor pixel: karakter hidup yang jalan, ngobrol, ngopi, main arcade,
// dan bos yang berkeliling memeriksa karyawan. Digambar di kanvas dengan skala bulat
// supaya pixel tetap tajam.
import { drawText, drawIcon, textWidth } from './pixelfont.js';

const W = 256, COLS = 4, CELL = 64, TOP = 96, ROW = 64, LOUNGE = 74;
const SPEED = 24; // pixel per detik

const HAIR = ['#2b1d16', '#5a3825', '#c9a227', '#1c1c28', '#8a3b2e', '#e8e0d0', '#3d5a80'];
const SKIN = ['#f2c9a0', '#d9a273', '#b07a50', '#8a5a3a'];
const SHIRT = ['#4e8cff', '#43b581', '#e0654f', '#b06ce0', '#f0a33a', '#2fb8c9', '#e05a9c', '#8d99ae'];
const PANTS = ['#2d3047', '#3b3355', '#4a4e69', '#22333b'];

const HEAD_FRONT = [
  '....hhhh....',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..sEssssEs..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
];
const HEAD_BACK = [
  '....hhhh....',
  '..hhhhhhhh..',
  '..hhhhhhhh..',
  '..hhhhhhhh..',
  '..hhhhhhhh..',
  '...hhhhhh...',
  '....ssss....',
];
const BOSS_FACE = [
  '....hhhh....',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..KKKKKKKK..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
];
const SEC_FACE = [
  '....hbbh....',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..gEgssgEg..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
];
const TORSO = [
  '..ccckkccc..',
  '.cccccccccc.',
  '.cccccccccc.',
  '.cccccccccc.',
  '.cccccccccc.',
];
const BOSS_TORSO = [
  '..cccwwccc..',
  '.ccccrrcccc.',
  '.ccccrrcccc.',
  '.cccccrcccc.',
  '.cccccccccc.',
];

const STATUS_LABEL = {
  building: 'Sedang deploy…', success: 'Deploy sukses', failed: 'Deploy gagal!',
  sleep: 'Tidur — 3 hari tanpa aktivitas', idle: 'Santai, belum ada deploy', unknown: 'Status tidak diketahui',
};
export { STATUS_LABEL };

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const LOUNGE_SPOTS = [
  { key: 'cooler', x: 30, label: 'minum air', icon: 'drop', dur: [3, 5] },
  { key: 'coffee', x: 76, label: 'bikin kopi', icon: 'coffee', dur: [4, 7] },
  { key: 'sofa', x: 128, label: 'rebahan di sofa', icon: 'note', dur: [7, 11] },
  { key: 'arcade', x: 180, label: 'main arcade', icon: 'game', dur: [6, 10] },
  { key: 'vending', x: 226, label: 'beli camilan', icon: 'star', dur: [3, 5] },
];

export class OfficeEngine {
  constructor(canvas, { onPick, onEvent } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick || (() => {});
    this.onEvent = onEvent || (() => {});
    this.agents = new Map();
    this.particles = [];
    this.spotsBusy = new Map();
    this.time = 0;
    this.frame = 0;
    this.scale = 1;
    this.selected = null;
    this.level = 1;
    this.rows = 1;
    this.geometry(0);
    this.boss = this.makeBoss();
    this.secAlerts = [];
    this.sec = this.makeSecretary();
    this.tick = this.tick.bind(this);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.handleClick = this.handleClick.bind(this);
    canvas.addEventListener('click', this.handleClick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('click', this.handleClick);
  }

  // ---------- tata letak ----------
  geometry(count) {
    this.rows = Math.max(1, Math.ceil(count / COLS));
    this.LT = TOP + this.rows * ROW; // atas lounge
    this.LL = this.LT + 54; // jalur jalan lounge
    this.H = this.LT + LOUNGE;
  }
  rowTop(r) { return TOP + r * ROW; }
  deskY(i) { return this.rowTop(Math.floor(i / COLS)) + 38; }
  cx(i) { return (i % COLS) * CELL + CELL / 2; }
  aisle(i) { return this.rowTop(Math.floor(i / COLS)) + 10; }
  seatLoc(i) { return { x: this.cx(i), y: this.deskY(i) - 3, laneY: this.aisle(i) }; }
  visitLoc(i) { return { x: this.cx(i) + 22, y: this.deskY(i) + 6, laneY: this.aisle(i) }; }
  loungeLoc(spot) { return { x: spot.x, y: this.LL, laneY: this.LL }; }
  secSeatLoc() { return { x: 34, y: TOP - 29, laneY: this.aisle(0), via: { x: 12, y: TOP - 29 } }; }
  bossSeatLoc() { return { x: W / 2, y: TOP - 30, laneY: this.aisle(0), via: { x: W / 2 + 42, y: TOP - 30 } }; }

  setScale(cssWidth, dpr) {
    // Render di kelipatan bulat (pixel tajam), lalu CSS menyesuaikan ke lebar layar.
    const s = Math.max(1, Math.ceil((cssWidth * dpr) / W));
    this.scale = s;
    this.canvas.width = W * s;
    this.canvas.height = this.H * s;
    this.canvas.style.width = '100%';
    this.canvas.style.height = 'auto';
    this.ctx.imageSmoothingEnabled = false;
  }

  setLevel(level) { this.level = level; }

  // ---------- data karyawan ----------
  setWorkers(list) {
    const oldRows = this.rows;
    this.geometry(list.length);
    const seen = new Set();
    list.forEach((w, i) => {
      seen.add(w.id);
      let a = this.agents.get(w.id);
      if (!a) {
        const h = hash(w.id);
        a = {
          id: w.id, kind: 'worker',
          look: { hair: HAIR[h % HAIR.length], skin: SKIN[(h >>> 4) % SKIN.length], shirt: SHIRT[(h >>> 8) % SHIRT.length], pants: PANTS[(h >>> 12) % PANTS.length] },
          prop: (h >>> 16) % 3, phase: h % 50,
          state: 'seated', pos: { x: 0, y: 0 }, path: [], dir: 'down', next: this.time + rand(2, 8),
          bubble: null, awakeUntil: 0,
        };
        this.agents.set(w.id, a);
      } else if (a.data && a.data.status !== 'success' && w.status === 'success') {
        this.confetti(this.cx(i), this.deskY(i) - 18);
        this.onEvent(`🎉 ${w.worker} berhasil deploy!`);
      } else if (a.data && a.data.status !== 'failed' && w.status === 'failed') {
        this.onEvent(`💥 Deploy ${w.worker} gagal!`);
      }
      a.data = w;
      a.index = i;
      a.home = this.seatLoc(i);
      if (a.state === 'seated' || oldRows !== this.rows) {
        a.state = 'seated'; a.path = []; a.pos = { x: a.home.x, y: a.home.y }; this.release(a);
      }
    });
    for (const id of [...this.agents.keys()]) if (!seen.has(id)) { this.release(this.agents.get(id)); this.agents.delete(id); }
    if (oldRows !== this.rows && this.boss.state !== 'seated') this.sendHome(this.boss, true);
    this.boss.home = this.bossSeatLoc();
    if (this.boss.state === 'seated') this.boss.pos = { x: this.boss.home.x, y: this.boss.home.y };
    if (oldRows !== this.rows && this.sec.state !== 'seated') this.sendHome(this.sec, true);
    this.sec.home = this.secSeatLoc();
    if (this._cssWidth) this.setScale(this._cssWidth, this._dpr);
  }

  resize(cssWidth, dpr) {
    this._cssWidth = cssWidth; this._dpr = dpr;
    this.setScale(cssWidth, dpr);
  }

  makeSecretary() {
    const home = this.secSeatLoc();
    return {
      id: '__sec', kind: 'secretary',
      look: { hair: '#4a2d24', skin: '#f5cdaa', shirt: '#9a5ad6', pants: '#3b2a55' },
      state: 'seated', pos: { x: home.x, y: home.y }, path: [], dir: 'down', home,
      next: 6, bubble: null, phase: 13, data: { worker: 'YUKI' },
    };
  }

  /** Pesan penting dari jadwal kuliah; sekretaris akan berjalan ke meja bos untuk melapor. */
  setSecretaryAlerts(list) {
    const fresh = list.some((m) => !this.secAlerts.includes(m));
    this.secAlerts = list;
    if (fresh && list.length && this.sec.state === 'seated') this.sec.next = Math.min(this.sec.next, this.time + 3);
  }

  secDecide(a) {
    a.next = this.time + rand(40, 60);
    if (this.secAlerts.length && this.boss.state === 'seated') {
      a.alertIdx = ((a.alertIdx ?? -1) + 1) % this.secAlerts.length;
      this.goTo(a, { x: W / 2 - 44, y: TOP - 22, laneY: this.aisle(0) }, { kind: 'report', msg: this.secAlerts[a.alertIdx] });
      return;
    }
    if (Math.random() < 0.3 && !this.spotsBusy.has('cooler')) {
      this.spotsBusy.set('cooler', a.id);
      this.goTo(a, this.loungeLoc(LOUNGE_SPOTS[0]), { kind: 'lounge', spot: LOUNGE_SPOTS[0] });
      this.onEvent('Sekretaris Yuki istirahat minum air');
    }
  }

  makeBoss() {
    const home = this.bossSeatLoc();
    return {
      id: '__boss', kind: 'boss',
      look: { hair: '#9aa0a6', skin: '#f2c9a0', shirt: '#22305a', pants: '#1a1f33' },
      state: 'seated', pos: { x: home.x, y: home.y }, path: [], dir: 'down', home,
      next: 8, bubble: null, phase: 7, data: { worker: 'BOS' },
    };
  }

  // ---------- perilaku ----------
  route(from, to) {
    const pts = [];
    const fx = from.via ? from.via.x : from.x;
    if (from.via) pts.push({ ...from.via });
    pts.push({ x: fx, y: from.laneY });
    const tx = to.via ? to.via.x : to.x;
    if (from.laneY !== to.laneY) {
      const side = (fx + tx) / 2 < W / 2 ? 5 : W - 5;
      pts.push({ x: side, y: from.laneY }, { x: side, y: to.laneY });
    }
    pts.push({ x: tx, y: to.laneY });
    if (to.via) pts.push({ ...to.via });
    pts.push({ x: to.x, y: to.y });
    return pts;
  }

  goTo(a, loc, act) {
    const from = a.state === 'seated' ? a.home : { x: a.pos.x, y: a.pos.y, laneY: a.lane ?? a.pos.y };
    a.path = this.route(from, loc);
    a.lane = loc.laneY;
    a.state = 'walk';
    a.act = act;
  }

  sendHome(a, instant) {
    this.release(a);
    if (instant) { a.state = 'seated'; a.path = []; a.pos = { x: a.home.x, y: a.home.y }; return; }
    this.goTo(a, a.home, { kind: 'home' });
  }

  release(a) {
    if (!a) return;
    for (const [k, v] of this.spotsBusy) if (v === a.id) this.spotsBusy.delete(k);
  }

  say(a, icon, secs = 2, color) {
    a.bubble = { icon, until: this.time + secs, color };
  }

  seatedWorkers() {
    return [...this.agents.values()].filter((a) => a.state === 'seated');
  }

  decide(a) {
    const st = a.data?.status;
    a.next = this.time + rand(6, 14);
    if (st === 'building' || st === 'sleep') return;
    if (st === 'failed') {
      if (Math.random() < 0.2) {
        const spot = LOUNGE_SPOTS[0];
        if (!this.spotsBusy.has(spot.key)) {
          this.spotsBusy.set(spot.key, a.id);
          this.goTo(a, this.loungeLoc(spot), { kind: 'lounge', spot });
          this.say(a, 'sweat', 2, '#5aa2ff');
          this.onEvent(`${a.data.worker} stres, pergi minum air…`);
        }
      }
      return;
    }
    const away = [...this.agents.values()].filter((x) => x.state !== 'seated').length;
    if (away >= Math.max(1, Math.ceil(this.agents.size * 0.5)) || Math.random() > 0.5) return;
    const r = Math.random();
    if (r < 0.35) {
      const others = this.seatedWorkers().filter((o) => o !== a && !o.visitor);
      if (others.length) {
        const t = pick(others);
        t.visitor = a.id;
        this.goTo(a, this.visitLoc(t.index), { kind: 'chat', target: t.id });
        this.onEvent(`${a.data.worker} nyamperin ${t.data.worker} buat ngobrol`);
        return;
      }
    }
    const free = LOUNGE_SPOTS.filter((s) => !this.spotsBusy.has(s.key));
    if (!free.length) return;
    const spot = pick(free);
    this.spotsBusy.set(spot.key, a.id);
    this.goTo(a, this.loungeLoc(spot), { kind: 'lounge', spot });
    this.onEvent(`${a.data.worker} pergi ${spot.label}`);
  }

  bossDecide(b) {
    b.next = this.time + rand(16, 28);
    const seated = this.seatedWorkers().filter((o) => !o.visitor);
    if (!seated.length || Math.random() < 0.2) {
      const spot = LOUNGE_SPOTS[1];
      if (!this.spotsBusy.has(spot.key)) {
        this.spotsBusy.set(spot.key, b.id);
        this.goTo(b, this.loungeLoc(spot), { kind: 'lounge', spot });
        this.onEvent('Bos turun ambil kopi ☕');
      }
      return;
    }
    const failed = seated.filter((o) => o.data.status === 'failed');
    const t = failed.length ? pick(failed) : pick(seated);
    t.visitor = b.id;
    this.goTo(b, this.visitLoc(t.index), { kind: 'inspect', target: t.id });
    this.onEvent(`Bos berkeliling, menuju meja ${t.data.worker}…`);
  }

  arrive(a) {
    const act = a.act || { kind: 'home' };
    if (act.kind === 'home') {
      a.state = 'seated';
      a.pos = { x: a.home.x, y: a.home.y };
      a.next = this.time + rand(8, 16);
      return;
    }
    a.state = 'act';
    a.dir = 'up';
    if (act.kind === 'lounge') {
      a.until = this.time + rand(...act.spot.dur);
      this.say(a, act.spot.icon, 2.5);
      if (act.spot.key === 'sofa') a.sitting = true;
      return;
    }
    if (act.kind === 'report') {
      a.dir = 'up';
      a.until = this.time + 4.5;
      this.say(a, 'bell', 3, '#9a5ad6');
      this.say(this.boss, 'thumb', 3, '#2e7d32');
      this.onEvent(`Sekretaris Yuki: "${act.msg}"`);
      return;
    }
    const t = this.agents.get(act.target);
    if (!t || t.state !== 'seated') { if (t) t.visitor = null; this.sendHome(a); return; }
    a.dir = 'down';
    if (act.kind === 'chat') {
      a.until = this.time + rand(5, 8);
      a.chatWith = t;
      a.chatTurn = 0;
      a.nextLine = this.time;
      return;
    }
    // inspeksi bos
    a.until = this.time + 4.5;
    const st = t.data.status;
    if (st === 'failed') {
      this.say(a, 'bang', 3, '#e53935'); this.say(t, 'sweat', 3.5, '#5aa2ff');
      this.onEvent(`Bos menegur ${t.data.worker}: "Kenapa deploy-nya gagal?!"`);
    } else if (st === 'sleep') {
      this.say(a, 'bang', 2.5, '#e53935'); t.awakeUntil = this.time + 12; this.say(t, 'q', 2.5);
      this.onEvent(`Bos membangunkan ${t.data.worker} yang ketiduran 😴`);
    } else if (st === 'success') {
      this.say(a, 'thumb', 3, '#2e7d32'); this.say(t, 'heart', 3, '#e05a9c');
      this.onEvent(`Bos memuji ${t.data.worker}: kerja bagus! 👍`);
    } else if (st === 'building') {
      this.say(a, 'dots', 3); this.say(t, 'note', 3, '#4e8cff');
      this.onEvent(`Bos mengawasi ${t.data.worker} yang lagi deploy`);
    } else {
      this.say(a, 'q', 3); this.say(t, 'dots', 3);
      this.onEvent(`Bos menanyakan kabar proyek ${t.data.worker}`);
    }
  }

  finishAct(a) {
    const act = a.act || {};
    a.sitting = false;
    if (act.target) { const t = this.agents.get(act.target); if (t) t.visitor = null; }
    a.chatWith = null;
    if (a.kind === 'boss' && act.kind === 'inspect' && Math.random() < 0.4 && !this.spotsBusy.has('coffee')) {
      this.spotsBusy.set('coffee', a.id);
      a.lane = this.aisle(this.agents.get(act.target)?.index ?? 0);
      this.goTo(a, this.loungeLoc(LOUNGE_SPOTS[1]), { kind: 'lounge', spot: LOUNGE_SPOTS[1] });
      return;
    }
    this.sendHome(a);
  }

  updateAgent(a, dt) {
    if (a.bubble && this.time > a.bubble.until) a.bubble = null;
    if (a.state === 'seated') {
      if (this.time > a.next && !a.visitor) (a.kind === 'boss' ? this.bossDecide(a) : a.kind === 'secretary' ? this.secDecide(a) : this.decide(a));
      return;
    }
    if (a.state === 'walk') {
      let move = SPEED * dt;
      while (move > 0 && a.path.length) {
        const p = a.path[0];
        const dx = p.x - a.pos.x, dy = p.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.01) { a.path.shift(); continue; }
        a.dir = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right');
        const step = Math.min(move, d);
        a.pos.x += (dx / d) * step;
        a.pos.y += (dy / d) * step;
        move -= step;
        if (step === d) a.path.shift();
      }
      if (!a.path.length) this.arrive(a);
      return;
    }
    if (a.state === 'act') {
      if (a.chatWith && this.time > a.nextLine) {
        const lines = ['dots', 'ha', 'heart', 'note', 'thumb', 'star', 'q'];
        const who = a.chatTurn++ % 2 === 0 ? a : a.chatWith;
        this.say(who, pick(lines), 1.3);
        a.nextLine = this.time + 1.4;
      }
      if (a.act?.spot?.key === 'arcade' && Math.random() < dt * 0.4) this.say(a, pick(['star', 'game', 'ha']), 1);
      if (this.time > a.until) this.finishAct(a);
    }
  }

  confetti(x, y) {
    const colors = ['#f4c84a', '#4cc27a', '#5aa2ff', '#e05a9c', '#ffffff'];
    for (let i = 0; i < 26; i++) {
      this.particles.push({ x, y, vx: rand(-30, 30), vy: rand(-55, -20), life: rand(1, 1.8), c: pick(colors) });
    }
  }

  // ---------- loop ----------
  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.frame = Math.floor(this.time * 7);
    for (const a of this.agents.values()) this.updateAgent(a, dt);
    this.updateAgent(this.boss, dt);
    this.updateAgent(this.sec, dt);
    this.particles = this.particles.filter((p) => {
      p.life -= dt; p.vy += 90 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      return p.life > 0;
    });
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  }

  handleClick(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * this.H;
    const hits = [];
    for (const a of [...this.agents.values(), this.boss, this.sec]) {
      const p = a.state === 'seated' ? { x: a.home.x, y: a.kind === 'worker' ? this.deskY(a.index) : TOP - 20 } : a.pos;
      const box = a.state === 'seated' ? [p.x - 14, p.y - 22, p.x + 14, p.y + 16] : [p.x - 8, p.y - 22, p.x + 8, p.y + 2];
      if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) hits.push({ a, y: p.y });
    }
    if (!hits.length) return;
    hits.sort((m, n) => n.y - m.y);
    const a = hits[0].a;
    this.selected = a.id;
    this.say(a, a.kind === 'boss' ? 'star' : a.kind === 'secretary' ? 'bell' : 'q', 1.5);
    this.onPick(a.kind === 'boss' ? { boss: true } : a.kind === 'secretary' ? { secretary: true } : a.data, a.state !== 'seated' ? (a.act?.spot?.label || (a.act?.kind === 'chat' ? 'lagi ngobrol' : 'sedang jalan')) : null);
  }

  // ---------- menggambar ----------
  px(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  sprite(rows, map, x, y) {
    x = Math.round(x); y = Math.round(y);
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < rows[r].length; c++) {
        const col = map[rows[r][c]];
        if (col) this.px(x + c, y + r, 1, 1, col);
      }
  }

  palette(a, eyesClosed) {
    const L = a.look;
    return {
      h: L.hair, s: L.skin, m: shade(L.skin, 0.65), E: eyesClosed ? shade(L.skin, 0.72) : '#1b1b1b',
      c: L.shirt, k: shade(L.shirt, 0.7), K: '#0d0d0d', w: '#ffffff', r: '#d32f2f',
      g: '#ffcf4a', b: shade(L.hair, 0.8),
    };
  }

  drawUpper(a, x, y, back, eyesClosed) {
    const pal = this.palette(a, eyesClosed);
    const head = back ? HEAD_BACK : a.kind === 'boss' ? BOSS_FACE : a.kind === 'secretary' ? SEC_FACE : HEAD_FRONT;
    this.sprite(head, pal, x, y);
    if (back && a.kind === 'secretary') this.px(x + 5, y - 1, 2, 2, pal.b);
    this.sprite(a.kind === 'worker' ? TORSO : BOSS_TORSO, { ...pal, r: a.kind === 'secretary' ? '#e05a9c' : pal.r }, x, y + 7);
    if (a.kind === 'boss' && !back && this.frame % 40 < 2) this.px(x + 3, y + 3, 1, 1, '#ffffff');
  }

  drawStanding(a) {
    const x = Math.round(a.pos.x) - 6, y = Math.round(a.pos.y) - 18;
    const walking = a.state === 'walk';
    const f = walking ? this.frame % 4 : 0;
    // bayangan
    this.ctx.fillStyle = 'rgba(0,0,0,.28)';
    this.ctx.fillRect(x + 2, y + 17, 8, 2);
    if (a.sitting) {
      this.drawUpper(a, x, y, false, false);
      return;
    }
    const back = a.dir === 'up';
    const blink = (this.frame + a.phase) % 37 === 0;
    this.drawUpper(a, x, y, back, blink);
    // tangan berayun
    const sw = walking ? (f === 1 ? -1 : f === 3 ? 1 : 0) : 0;
    this.px(x + 1, y + 12 + sw, 1, 2, a.look.skin);
    this.px(x + 10, y + 12 - sw, 1, 2, a.look.skin);
    // celana & kaki
    this.px(x + 2, y + 12, 8, 1, a.look.pants);
    const lLift = f === 1 ? 1 : 0, rLift = f === 3 ? 1 : 0;
    this.px(x + 2, y + 13, 3, 3 - lLift, a.look.pants);
    this.px(x + 7, y + 13, 3, 3 - rLift, a.look.pants);
    this.px(x + 2, y + 16 - lLift, 3, 1, '#1a1a1a');
    this.px(x + 7, y + 16 - rLift, 3, 1, '#1a1a1a');
    if (this.selected === a.id) this.drawSelect(a.pos.x, y - 4);
  }

  drawSelect(cx, y) {
    const b = this.frame % 6 < 3 ? 0 : 1;
    this.px(cx - 1, y - 3 + b, 3, 1, '#f4c84a');
    this.px(cx, y - 2 + b, 1, 1, '#f4c84a');
  }

  drawBubble(a, x, y) {
    if (!a.bubble) return;
    const bx = Math.round(x), by = Math.round(y);
    const border = a.bubble.color || '#20232f';
    this.px(bx, by, 9, 9, border);
    this.px(bx + 1, by + 1, 7, 7, '#ffffff');
    this.px(bx + 1, by + 9, 2, 1, border);
    this.px(bx, by + 10, 1, 1, border);
    drawIcon(this.px.bind(this), a.bubble.icon, bx + 2, by + 2, a.bubble.color || '#20232f');
  }

  // ---------- ruangan ----------
  drawRoom(now) {
    const H = this.H;
    // dinding atas
    this.px(0, 0, W, 50, '#343a56');
    for (let x = 0; x < W; x += 16) this.px(x, 0, 1, 48, '#30354f');
    this.px(0, 48, W, 4, '#1f2336');
    // lantai kayu
    for (let y = 52; y < this.LT; y += 6) {
      const off = ((y - 52) / 6) % 2 ? 14 : 0;
      for (let x = -28 + off; x < W; x += 28) {
        this.px(x, y, 28, 6, '#5f4a3a');
        this.px(x + 1, y, 27, 5, '#6d5543');
      }
    }
    // lantai lounge (keramik)
    for (let y = this.LT; y < H; y += 8)
      for (let x = 0; x < W; x += 8) this.px(x, y, 8, 8, ((x + y) / 8) % 2 ? '#4b5a6e' : '#55667c');
    this.px(0, this.LT, W, 3, '#1f2336');
    this.px(0, this.LT + 3, W, 1, '#2c3348');

    const hr = (now.getUTCHours() + 9) % 24;
    this.window(10, 9, hr);
    this.window(W - 50, 9, hr);
    this.clock(W / 2, 18, now);
    this.poster(62, 8);
    this.trophies(W - 98, 30);
    this.plant(2, 36);
    this.plant(W - 13, 36);
    // karpet bos
    this.px(64, 56, 128, TOP - 58, '#5b2330');
    this.px(66, 58, 124, TOP - 62, '#73303e');
    for (let x = 70; x < 186; x += 8) this.px(x, 60, 4, 1, '#8c4150');
  }

  window(x, y, hr) {
    const day = hr >= 6 && hr < 16, dusk = hr >= 16 && hr < 19;
    const sky = day ? '#8fd3ff' : dusk ? '#f2a65a' : '#1b2350';
    this.px(x - 2, y - 2, 44, 30, '#1b1e2b');
    this.px(x, y, 40, 26, sky);
    if (!day && !dusk) {
      for (let i = 0; i < 7; i++) if ((this.frame + i * 5) % 24 > 2) this.px(x + ((i * 13 + 5) % 38), y + ((i * 7 + 3) % 22), 1, 1, '#fff');
      this.px(x + 30, y + 4, 5, 5, '#f4f0c8'); this.px(x + 32, y + 3, 4, 4, sky);
    } else {
      // gedung kota
      const c = day ? '#6f8fb0' : '#7a4b5a';
      [[2, 14, 7], [10, 9, 8], [19, 16, 6], [26, 6, 9], [36, 12, 4]].forEach(([bx, bh, bw]) => this.px(x + bx, y + 26 - bh, bw, bh, c));
      const cx = x + ((this.time * 2 + x) % 52) - 10;
      this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(x, y, 40, 26); this.ctx.clip();
      this.px(cx, y + 5, 10, 2, '#fff'); this.px(cx + 2, y + 4, 6, 1, '#fff');
      this.ctx.restore();
    }
    this.px(x + 19, y, 2, 26, '#1b1e2b');
    this.px(x, y + 12, 40, 2, '#1b1e2b');
    this.px(x - 3, y + 26, 46, 3, '#cfc8b8');
  }

  clock(cx, cy, now) {
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++) {
        const d = dx * dx + dy * dy;
        if (d <= 50) this.px(cx + dx, cy + dy, 1, 1, d > 34 ? '#1b1e2b' : '#f4f1e8');
      }
    const t = new Date(now.getTime() + 9 * 3600e3);
    const m = t.getUTCMinutes(), h = t.getUTCHours() % 12;
    const hand = (ang, len, col) => { for (let s = 0; s <= len; s++) this.px(cx + Math.round(Math.sin(ang) * s), cy - Math.round(Math.cos(ang) * s), 1, 1, col); };
    hand((m / 60) * Math.PI * 2, 5, '#1b1e2b');
    hand(((h + m / 60) / 12) * Math.PI * 2, 3, '#c0392b');
  }

  poster(x, y) {
    this.px(x, y, 44, 22, '#1b1e2b');
    this.px(x + 1, y + 1, 42, 20, '#f4c84a');
    this.px(x + 2, y + 2, 40, 18, '#2a2110');
    drawText(this.px.bind(this), 'KANTOR', x + 10, y + 4, '#f4c84a');
    drawText(this.px.bind(this), 'BOS', x + 16, y + 12, '#ffffff');
  }

  trophies(x, y) {
    this.px(x, y + 8, 40, 2, '#8a5a3c');
    const n = Math.min(6, this.level);
    for (let i = 0; i < n; i++) {
      const tx = x + 2 + i * 6;
      this.px(tx, y + 2, 4, 3, '#f4c84a');
      this.px(tx + 1, y + 5, 2, 2, '#d9ad2f');
      this.px(tx, y + 7, 4, 1, '#b8902f');
    }
    drawText(this.px.bind(this), `LV${this.level}`, x + 2, y - 6, '#f4c84a');
  }

  plant(x, y) {
    const sway = this.frame % 16 < 8 ? 0 : 1;
    this.px(x + 1, y + 6, 9, 8, '#a0522d');
    this.px(x, y + 6, 11, 2, '#b8653a');
    this.px(x + 4 + sway, y - 2, 3, 8, '#3f9b4f');
    this.px(x + 1, y + 1, 3, 5, '#4fb35f');
    this.px(x + 7, y, 3, 6, '#2f8a40');
  }

  bossDesk() {
    const cx = W / 2, top = TOP - 26;
    // kursi besar
    this.px(cx - 10, top - 20, 20, 20, '#14161f');
    this.px(cx - 9, top - 19, 18, 18, '#2c2f42');
    if (this.boss.state === 'seated') {
      const bob = this.frame % 30 < 2 ? 1 : 0;
      this.drawUpper(this.boss, cx - 6, top - 13 + bob, false, false);
      this.px(cx - 8, top - 1, 2, 2, this.boss.look.skin);
      this.px(cx + 6, top - 1, 2, 2, this.boss.look.skin);
    }
    // monitor
    this.px(cx - 30, top - 14, 18, 12, '#1b1e2b');
    this.px(cx - 29, top - 13, 16, 10, '#2a4a7a');
    for (let i = 0; i < 4; i++) this.px(cx - 27, top - 11 + i * 2, 4 + ((this.frame + i * 3) % 8), 1, '#7fb2ff');
    this.px(cx - 22, top - 2, 2, 2, '#1b1e2b');
    // meja
    this.px(cx - 36, top, 72, 4, '#9a6a45');
    this.px(cx - 36, top + 4, 72, 12, '#6e452c');
    this.px(cx - 34, top + 5, 68, 10, '#7d5035');
    this.px(cx - 10, top + 7, 20, 6, '#e9c46a');
    this.px(cx - 9, top + 8, 18, 4, '#b8902f');
    drawText(this.px.bind(this), 'BOS', cx - 5, top + 8, '#2a2110');
    // mug
    this.px(cx + 22, top - 5, 5, 5, '#ffffff');
    this.px(cx + 27, top - 4, 1, 2, '#ffffff');
    this.px(cx + 23, top - 4, 3, 1, '#5b3a22');
    const s = this.frame % 6;
    this.px(cx + 24 - (s > 2 ? 1 : 0), top - 8 - (s % 3), 1, 2, 'rgba(255,255,255,.5)');
    if (this.boss.state === 'seated') this.drawBubble(this.boss, cx + 8, top - 30);
  }

  secDesk() {
    const cx = 34, top = TOP - 26, a = this.sec;
    this.px(cx - 8, top - 18, 16, 18, '#14161f');
    this.px(cx - 7, top - 17, 14, 16, '#4a2f6a');
    if (a.state === 'seated') {
      const bob = this.frame % 34 < 2 ? 1 : 0;
      this.drawUpper(a, cx - 6, top - 13 + bob, false, (this.frame + 5) % 43 === 0);
      const typing = this.frame % 3 === 0;
      this.px(cx - 8, top - 1 - (typing ? 1 : 0), 2, 2, a.look.skin);
      this.px(cx + 6, top - 1, 2, 2, a.look.skin);
    }
    // meja resepsionis
    this.px(cx - 18, top, 36, 3, '#c9a0e8');
    this.px(cx - 18, top + 3, 36, 11, '#7a4fa8');
    this.px(cx - 16, top + 4, 32, 9, '#8a5cbc');
    this.px(cx - 6, top + 6, 12, 5, '#e9c46a');
    this.px(cx - 5, top + 7, 10, 3, '#b8902f');
    // laptop pink + telepon + kalender kecil
    this.px(cx - 4, top - 6, 9, 6, '#f2b8d6');
    this.px(cx - 3, top - 5, 7, 4, this.secAlerts.length && this.frame % 6 < 3 ? '#ffe28a' : '#fde2ef');
    this.px(cx + 9, top - 3, 5, 3, '#2b2b33');
    this.px(cx + 10, top - 4, 3, 1, '#2b2b33');
    this.px(cx - 15, top - 6, 7, 6, '#ffffff');
    this.px(cx - 15, top - 6, 7, 2, '#e05a5a');
    this.px(cx - 13, top - 3, 3, 2, '#20232f');
    if (a.state === 'seated') {
      if (a.bubble) this.drawBubble(a, cx + 5, top - 30);
      else if (this.secAlerts.length && this.frame % 10 < 7) {
        const bx = cx + 5, by = top - 30;
        this.px(bx, by, 9, 9, '#9a5ad6'); this.px(bx + 1, by + 1, 7, 7, '#fff');
        this.px(bx + 1, by + 9, 2, 1, '#9a5ad6'); this.px(bx, by + 10, 1, 1, '#9a5ad6');
        drawIcon(this.px.bind(this), 'bell', bx + 2, by + 2, '#9a5ad6');
      }
    }
  }

  desk(cx, dy) {
    this.px(cx - 16, dy, 32, 3, '#a87650');
    this.px(cx - 16, dy + 3, 32, 9, '#7c5236');
    this.px(cx - 14, dy + 4, 28, 7, '#8b5d3e');
    this.px(cx - 16, dy + 12, 2, 2, '#5c3b26');
    this.px(cx + 14, dy + 12, 2, 2, '#5c3b26');
  }

  drawWorkstation(a) {
    const i = a.index, cx = this.cx(i), dy = this.deskY(i);
    const st = a.data.status;
    const seated = a.state === 'seated';
    const sleeping = st === 'sleep' && this.time > a.awakeUntil;
    const f = this.frame + a.phase;
    // kursi
    this.px(cx - 8, dy - 11, 16, 11, '#14161f');
    this.px(cx - 7, dy - 10, 14, 9, shade(a.look.shirt, 0.45));
    if (seated) {
      const y0 = dy - 13 + (sleeping ? 2 : 0);
      this.drawUpper(a, cx - 6, y0, false, sleeping || (f % 41 === 0));
      if (st === 'failed') {
        this.px(cx - 3, y0 + 4, 1, 1, '#e57373'); this.px(cx + 2, y0 + 4, 1, 1, '#e57373');
        this.px(cx + 4, y0 + 1 + (f % 6 > 2 ? 1 : 0), 1, 2, '#7ec8ff');
      }
    }
    this.desk(cx, dy);
    // laptop + cahaya layar
    const glow = st === 'building' ? ['#7fb2ff', '#9ff0c0', '#ffe28a'][Math.floor(f / 2) % 3] : st === 'failed' ? (f % 8 < 4 ? '#ff8a8a' : '#c9ced8') : '#c9ced8';
    this.px(cx - 6, dy - 7, 12, 7, '#9aa1b0');
    this.px(cx - 5, dy - 6, 10, 5, glow === '#c9ced8' ? '#b4bac6' : glow);
    this.px(cx - 1, dy - 4, 2, 2, a.look.shirt);
    this.px(cx - 7, dy, 14, 1, '#8c93a1');
    if (seated && !sleeping) {
      const typing = st === 'building' || (st !== 'failed' && f % 24 < 6);
      const lh = typing && f % 2 === 0 ? -1 : 0, rh = typing && f % 2 === 1 ? -1 : 0;
      this.px(cx - 9, dy - 1 + lh, 2, 2, a.look.skin);
      this.px(cx + 7, dy - 1 + rh, 2, 2, a.look.skin);
    }
    // barang di meja
    if (a.prop === 0) { this.px(cx + 10, dy - 3, 3, 3, '#a0522d'); this.px(cx + 10, dy - 6, 3, 3, '#4fb35f'); }
    else if (a.prop === 1) { this.px(cx + 10, dy - 4, 3, 4, '#fff'); this.px(cx + 13, dy - 3, 1, 2, '#fff'); }
    else { this.px(cx - 14, dy - 3, 5, 3, '#f4f1e8'); this.px(cx - 14, dy - 2, 5, 1, '#d8d3c4'); }
    // papan nama
    const name = String(a.data.worker || '').toUpperCase().slice(0, 9);
    const tw = textWidth(name) + 4;
    const plate = st === 'failed' ? '#8e2f3a' : st === 'building' ? '#1d4f99' : st === 'success' ? '#23613f' : st === 'sleep' ? '#4a3f80' : '#20232f';
    this.px(cx - Math.ceil(tw / 2), dy + 15, tw, 9, '#0c0e15');
    this.px(cx - Math.ceil(tw / 2) + 1, dy + 16, tw - 2, 7, plate);
    drawText(this.px.bind(this), name, cx - Math.ceil(tw / 2) + 2, dy + 17, '#ffffff');
    if (this.selected === a.id && seated) this.drawSelect(cx, dy - 22);
    // status
    if (seated) {
      if (a.bubble) this.drawBubble(a, cx + 7, dy - 27);
      else this.statusMark(a, cx, dy, f, sleeping);
    }
  }

  statusMark(a, cx, dy, f, sleeping) {
    const st = a.data.status;
    const bx = cx + 7, by = dy - 27;
    const box = (border) => {
      this.px(bx, by, 9, 9, border); this.px(bx + 1, by + 1, 7, 7, '#fff');
      this.px(bx + 1, by + 9, 2, 1, border); this.px(bx, by + 10, 1, 1, border);
    };
    const p = this.px.bind(this);
    if (st === 'success') { box('#2e7d32'); drawIcon(p, 'check', bx + 2, by + 2, '#2e7d32'); }
    else if (st === 'failed') { if (f % 8 < 6) { box('#c62828'); drawIcon(p, 'bang', bx + 2, by + 2, '#c62828'); } }
    else if (st === 'building') { box('#1565c0'); const n = f % 4; for (let i = 0; i < 3; i++) this.px(bx + 2 + i * 2, by + 4, 1, 1, i < n ? '#1565c0' : '#c7d6ea'); }
    else if (sleeping) { const t = f % 12; drawIcon(p, 'z', cx + 6 + Math.floor(t / 4), dy - 20 - Math.floor(t / 2), '#dfe6ff'); }
    else if (st === 'unknown') { box('#757575'); drawIcon(p, 'q', bx + 2, by + 2, '#757575'); }
  }

  emptyDesk(i) {
    const cx = this.cx(i), dy = this.deskY(i);
    this.px(cx - 8, dy - 11, 16, 11, '#1d1f2b');
    this.desk(cx, dy);
    this.px(cx - 5, dy - 6, 10, 6, '#3a3f52');
    drawText(this.px.bind(this), '+', cx - 1, dy + 17, '#4a5170');
  }

  // perabot lounge (dibelakang karakter)
  lounge() {
    const L = this.LL, p = this.px.bind(this);
    // dispenser
    p(24, L - 30, 12, 9, '#a8d8f0'); p(25, L - 29, 10, 7, '#c7ecff');
    p(23, L - 21, 14, 16, '#e8e8ee'); p(26, L - 17, 2, 2, '#4e8cff'); p(32, L - 17, 2, 2, '#e0654f');
    if (this.frame % 30 < 3) p(29, L - 25 - (this.frame % 3), 1, 1, '#fff');
    // meja kopi + mesin
    p(62, L - 16, 28, 11, '#6e452c'); p(62, L - 18, 28, 2, '#9a6a45');
    p(68, L - 32, 14, 14, '#2b2b33'); p(70, L - 30, 10, 5, '#3d3d48'); p(73, L - 23, 4, 3, '#111');
    p(71, L - 29, 2, 2, this.spotsBusy.has('coffee') && this.frame % 4 < 2 ? '#4cc27a' : '#c62828');
    if (this.spotsBusy.has('coffee')) { const s = this.frame % 6; p(75 - (s > 2 ? 1 : 0), L - 37 - (s % 3), 1, 2, 'rgba(255,255,255,.6)'); }
    // sofa (sandaran)
    p(108, L - 22, 40, 12, '#6a3fa0'); p(110, L - 20, 36, 8, '#7d4fb8');
    // arcade
    p(172, L - 38, 18, 34, '#1d1b3a'); p(173, L - 37, 16, 32, '#2e2a5c');
    const playing = this.spotsBusy.has('arcade');
    const scr = playing ? ['#ff6b9a', '#6bd5ff', '#ffe36b', '#7dff8a'][this.frame % 4] : '#16324f';
    p(175, L - 34, 12, 10, '#0b0b12'); p(176, L - 33, 10, 8, scr);
    if (playing) { p(178 + (this.frame % 5), L - 30, 2, 2, '#fff'); }
    p(175, L - 22, 12, 4, '#454080'); p(177, L - 21, 2, 2, '#e05a5a'); p(182, L - 21, 2, 2, '#4cc27a');
    drawText(p, 'GO', 177, L - 41, '#f4c84a');
    // vending
    p(216, L - 40, 22, 36, '#c0392b'); p(218, L - 38, 13, 26, '#1b2350');
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) p(219 + c * 4, L - 37 + r * 6, 3, 4, ['#f4c84a', '#4cc27a', '#5aa2ff', '#e05a9c'][(r + c) % 4]);
    p(233, L - 34, 3, 8, '#e8e8ee'); p(219, L - 10, 11, 4, '#111');
  }

  sofaFront() {
    const L = this.LL, p = this.px.bind(this);
    p(106, L - 10, 44, 8, '#5a3388'); p(108, L - 11, 40, 3, '#8f63c9');
    p(104, L - 16, 6, 14, '#4a2a72'); p(146, L - 16, 6, 14, '#4a2a72');
  }

  nightOverlay(now) {
    const hr = (now.getUTCHours() + 9) % 24;
    if (hr >= 6 && hr < 18) return;
    const c = this.ctx;
    c.save();
    c.fillStyle = hr >= 18 && hr < 20 ? 'rgba(30,20,70,.25)' : 'rgba(8,10,40,.42)';
    c.fillRect(0, 0, W, this.H);
    c.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, col) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const a of this.agents.values()) glow(this.cx(a.index), this.deskY(a.index) - 5, 16, a.data.status === 'building' ? 'rgba(90,160,255,.35)' : 'rgba(120,140,200,.18)');
    glow(W / 2 - 21, TOP - 34, 18, 'rgba(90,150,255,.3)');
    glow(181, this.LL - 29, 14, 'rgba(255,100,200,.3)');
    glow(W / 2, 22, 30, 'rgba(255,220,150,.10)');
    c.restore();
  }

  draw() {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    const now = new Date();
    this.drawRoom(now);
    this.bossDesk();
    this.secDesk();
    this.lounge();

    // urutkan semua yang berdiri di lantai berdasarkan posisi kaki (y)
    const items = [];
    const slots = this.rows * COLS;
    const byIndex = new Map([...this.agents.values()].map((a) => [a.index, a]));
    for (let i = 0; i < slots; i++) {
      const a = byIndex.get(i);
      items.push({ y: this.deskY(i) + 12, draw: () => (a ? this.drawWorkstation(a) : this.emptyDesk(i)) });
    }
    items.push({ y: this.LL + 1, draw: () => this.sofaFront() });
    for (const a of [...this.agents.values(), this.boss, this.sec]) {
      if (a.state === 'seated') continue;
      items.push({ y: a.pos.y + (a.sitting ? -0.5 : 0), draw: () => { this.drawStanding(a); this.drawBubble(a, a.pos.x + 3, a.pos.y - 31); } });
    }
    items.sort((m, n) => m.y - n.y).forEach((it) => it.draw());

    for (const p of this.particles) this.px(p.x, p.y, 2, 2, p.c);
    this.nightOverlay(now);
  }
}
