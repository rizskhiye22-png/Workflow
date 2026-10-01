// Kantor pixel: setiap proyek = satu karyawan di mejanya.
// Digambar di canvas resolusi kecil lalu diperbesar (image-rendering: pixelated).

const W = 192, COLS = 3, CELL = 64, TOP = 80, ROW = 56;

const HAIR = ['#2b1d16', '#5a3825', '#c9a227', '#1c1c28', '#8a3b2e', '#e8e0d0'];
const SKIN = ['#f2c9a0', '#d9a273', '#b07a50', '#7a4b2e'];
const SHIRT = ['#4e8cff', '#43b581', '#e0654f', '#b06ce0', '#f0a33a', '#2fb8c9', '#e05a9c', '#8d99ae'];

const WORKER = [
  '....hhhh....',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..sEssssEs..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
  '..ccckkccc..',
  '.cccccccccc.',
  '.cccccccccc.',
  '.cccccccccc.',
  '.cccccccccc.',
];

const BOSS = [
  '....gggg....',
  '..gggggggg..',
  '..gssssssg..',
  '..KKKKKKKK..',
  '..ssssssss..',
  '...ssmmss...',
  '....ssss....',
  '..nnnwwnnn..',
  '.nnnnrrnnnn.',
  '.nnnnrrnnnn.',
  '.nnnnnrnnnn.',
  '.nnnnnnnnnn.',
];

const GLYPH = {
  check: ['.....', '....#', '...#.', '#.#..', '.#...'],
  bang: ['..#..', '..#..', '..#..', '.....', '..#..'],
  q: ['.###.', '...#.', '..#..', '.....', '..#..'],
  z: ['###', '..#', '.#.', '#..', '###'],
};

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

export const STATUS_TEXT = {
  building: 'Sedang deploy…',
  success: 'Deploy sukses',
  failed: 'Deploy gagal!',
  sleep: 'Tidur — tidak ada aktivitas 3 hari',
  idle: 'Santai, belum ada deploy',
  unknown: 'Status tidak diketahui',
};

export class Office {
  constructor(canvas, layer, workers, onPick) {
    this.canvas = canvas;
    this.layer = layer;
    this.onPick = onPick;
    this.ctx = canvas.getContext('2d');
    this.frame = 0;
    this.last = 0;
    this.setWorkers(workers);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setWorkers(workers) {
    this.workers = workers.map((w, i) => {
      const h = hash(w.id);
      return {
        ...w,
        i,
        hair: HAIR[h % HAIR.length],
        skin: SKIN[(h >>> 4) % SKIN.length],
        shirt: SHIRT[(h >>> 8) % SHIRT.length],
        prop: (h >>> 12) % 3, // 0 tanaman, 1 mug, 2 tumpukan kertas
        phase: h % 40,
      };
    });
    const rows = Math.max(1, Math.ceil(this.workers.length / COLS));
    this.rows = rows;
    this.h = TOP + rows * ROW + 4;
    this.canvas.width = W;
    this.canvas.height = this.h;
    this.ctx.imageSmoothingEnabled = false;
    this.buildLayer();
    this.draw();
  }

  pos(i) {
    const col = i % COLS, row = Math.floor(i / COLS);
    return { cx: col * CELL + CELL / 2, deskY: TOP + row * ROW + 30 };
  }

  buildLayer() {
    this.layer.innerHTML = '';
    const pct = (v, total) => `${(v / total) * 100}%`;
    for (const w of this.workers) {
      const { cx, deskY } = this.pos(w.i);
      const b = document.createElement('button');
      b.className = 'worker-hit';
      b.style.left = pct(cx - CELL / 2 + 2, W);
      b.style.top = pct(deskY - 26, this.h);
      b.style.width = pct(CELL - 4, W);
      b.style.height = pct(44, this.h);
      b.setAttribute('aria-label', `${w.worker} (${w.name}): ${STATUS_TEXT[w.status] || ''}`);
      const tag = document.createElement('span');
      tag.className = `name-tag st-${w.status}`;
      tag.textContent = w.worker;
      b.appendChild(tag);
      b.addEventListener('click', () => this.onPick(w));
      this.layer.appendChild(b);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  loop(t) {
    if (t - this.last > 140) {
      this.last = t;
      this.frame++;
      this.draw();
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  px(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  sprite(rows, map, x, y) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const col = map[rows[r][c]];
        if (col) this.px(x + c, y + r, 1, 1, col);
      }
    }
  }

  glyph(name, x, y, color) {
    const g = GLYPH[name];
    for (let r = 0; r < g.length; r++)
      for (let c = 0; c < g[r].length; c++) if (g[r][c] === '#') this.px(x + c, y + r, 1, 1, color);
  }

  // ---------- Ruangan ----------
  draw() {
    const { h } = this;
    const now = new Date();
    // dinding
    this.px(0, 0, W, 42, '#3a3f58');
    for (let x = 0; x < W; x += 16) this.px(x, 0, 1, 40, '#363b52');
    this.px(0, 40, W, 3, '#262a3b');
    // lantai kayu
    for (let y = 43; y < h; y += 6) {
      for (let x = ((y / 6) % 2) * 12; x < W + 24; x += 24) {
        this.px(x - 24, y, 24, 6, '#7a5f48');
        this.px(x - 24, y, 23, 5, '#6d5440');
      }
    }
    this.window(10, 8, now);
    this.window(W - 46, 8, now);
    this.clock(W / 2, 17, now);
    this.plant(4, 30);
    this.cooler(W - 14, 26);
    // karpet bos
    this.px(52, 50, 88, TOP - 52, '#6b2a35');
    this.px(54, 52, 84, TOP - 56, '#83343f');
    this.boss();
    for (let i = 0; i < this.rows * COLS; i++) {
      const w = this.workers[i];
      if (w) this.worker(w); else this.emptyDesk(i);
    }
  }

  window(x, y, now) {
    const hr = now.getHours();
    const sky = hr >= 6 && hr < 16 ? '#8fd3ff' : hr >= 16 && hr < 19 ? '#f2a65a' : '#1b2350';
    this.px(x - 1, y - 1, 38, 24, '#20232f');
    this.px(x, y, 36, 22, sky);
    if (sky === '#1b2350') {
      for (let i = 0; i < 6; i++) {
        const sx = x + ((i * 13 + 5) % 34), sy = y + ((i * 7 + 3) % 18);
        if ((this.frame + i * 3) % 20 > 2) this.px(sx, sy, 1, 1, '#ffffff');
      }
      this.px(x + 27, y + 4, 4, 4, '#f4f0c8');
      this.px(x + 28, y + 4, 3, 3, '#1b2350');
    } else {
      const cx = x + ((this.frame / 6 + x) % 40) - 6;
      this.px(Math.max(x, cx), y + 6, Math.min(8, x + 36 - Math.max(x, cx)), 2, '#ffffff');
      this.px(Math.max(x, cx + 2), y + 5, Math.max(0, Math.min(4, x + 36 - (cx + 2))), 1, '#ffffff');
    }
    this.px(x + 17, y, 2, 22, '#20232f');
    this.px(x, y + 10, 36, 2, '#20232f');
    this.px(x - 2, y + 22, 40, 2, '#c8c2b4');
  }

  clock(cx, cy, now) {
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const d = dx * dx + dy * dy;
        if (d <= 40) this.px(cx + dx, cy + dy, 1, 1, d > 26 ? '#20232f' : '#f4f1e8');
      }
    const hand = (ang, len, col) => {
      for (let s = 0; s <= len; s++)
        this.px(cx + Math.round(Math.sin(ang) * s), cy - Math.round(Math.cos(ang) * s), 1, 1, col);
    };
    const m = now.getMinutes(), hh = now.getHours() % 12;
    hand((m / 60) * Math.PI * 2, 4, '#20232f');
    hand(((hh + m / 60) / 12) * Math.PI * 2, 2, '#c0392b');
  }

  plant(x, y) {
    const sway = this.frame % 16 < 8 ? 0 : 1;
    this.px(x + 1, y + 6, 8, 7, '#a0522d');
    this.px(x, y + 6, 10, 2, '#b8653a');
    this.px(x + 3 + sway, y, 4, 6, '#3f9b4f');
    this.px(x + 1, y + 2, 3, 4, '#4fb35f');
    this.px(x + 6, y + 1, 3, 5, '#2f8a40');
  }

  cooler(x, y) {
    this.px(x, y, 10, 8, '#a8d8f0');
    this.px(x + 1, y + 1, 8, 6, '#c7ecff');
    this.px(x - 1, y + 8, 12, 12, '#e8e8ee');
    this.px(x + 2, y + 11, 2, 2, '#4e8cff');
    this.px(x + 6, y + 11, 2, 2, '#e0654f');
    if (this.frame % 30 < 3) this.px(x + 4, y + 3 - (this.frame % 3), 1, 1, '#ffffff');
  }

  boss() {
    const cx = W / 2, deskY = TOP - 16;
    // kursi
    this.px(cx - 9, deskY - 16, 18, 16, '#1d1f2b');
    this.px(cx - 8, deskY - 15, 16, 14, '#2c2f42');
    const bob = this.frame % 24 < 2 ? 1 : 0;
    this.sprite(BOSS, {
      g: '#9aa0a6', s: '#f2c9a0', K: '#111111', m: '#b5523b',
      n: '#22305a', w: '#ffffff', r: '#d32f2f',
    }, cx - 6, deskY - 12 + bob);
    // kilau kacamata
    if (this.frame % 40 < 3) this.px(cx - 3, deskY - 9 + bob, 1, 1, '#ffffff');
    // monitor besar
    this.px(cx - 26, deskY - 12, 16, 11, '#20232f');
    this.px(cx - 25, deskY - 11, 14, 9, '#3b4058');
    this.px(cx - 19, deskY - 1, 2, 2, '#20232f');
    // meja
    this.px(cx - 30, deskY, 60, 4, '#9a6a45');
    this.px(cx - 30, deskY + 4, 60, 10, '#74492e');
    this.px(cx - 28, deskY + 5, 56, 8, '#82543a');
    // papan nama
    this.px(cx - 8, deskY + 6, 16, 4, '#e9c46a');
    this.px(cx - 6, deskY + 7, 12, 2, '#b8902f');
    // mug kopi + uap
    this.px(cx + 18, deskY - 5, 5, 5, '#ffffff');
    this.px(cx + 23, deskY - 4, 1, 2, '#ffffff');
    this.px(cx + 19, deskY - 4, 3, 1, '#5b3a22');
    const st = this.frame % 6;
    this.px(cx + 20 - (st > 2 ? 1 : 0), deskY - 8 - (st % 3), 1, 2, 'rgba(255,255,255,.55)');
  }

  emptyDesk(i) {
    const { cx, deskY } = this.pos(i);
    this.px(cx - 7, deskY - 9, 14, 9, '#2a2c3a');
    this.desk(cx, deskY, '#8a5f40', '#6a4630');
    this.px(cx - 4, deskY - 5, 8, 5, '#505569');
  }

  desk(cx, deskY, top, front) {
    this.px(cx - 15, deskY, 30, 3, top);
    this.px(cx - 15, deskY + 3, 30, 8, front);
    this.px(cx - 13, deskY + 4, 26, 6, shade(front, 1.12));
    this.px(cx - 15, deskY + 11, 2, 2, front);
    this.px(cx + 13, deskY + 11, 2, 2, front);
  }

  worker(w) {
    const { cx, deskY } = this.pos(w.i);
    const f = this.frame + w.phase;
    const sleeping = w.status === 'sleep';
    const blink = f % 36 === 0;
    // kursi
    this.px(cx - 8, deskY - 10, 16, 10, '#1d1f2b');
    this.px(cx - 7, deskY - 9, 14, 8, shade(w.shirt, 0.45));
    // badan
    const dy = sleeping ? 2 : 0;
    this.sprite(WORKER, {
      h: w.hair, s: w.skin, m: shade(w.skin, 0.65),
      E: sleeping || blink ? shade(w.skin, 0.75) : '#1b1b1b',
      c: w.shirt, k: shade(w.shirt, 0.7),
    }, cx - 6, deskY - 12 + dy);
    if (w.status === 'failed') {
      // wajah memerah + keringat
      this.px(cx - 3, deskY - 8, 1, 1, '#e57373');
      this.px(cx + 2, deskY - 8, 1, 1, '#e57373');
      this.px(cx + 4, deskY - 10 + (f % 6 > 2 ? 1 : 0), 1, 2, '#7ec8ff');
    }
    // meja
    this.desk(cx, deskY, '#a87650', '#7c5236');
    // laptop
    this.px(cx - 5, deskY - 6, 10, 6, '#c9ced8');
    this.px(cx - 4, deskY - 5, 8, 4, '#b4bac6');
    this.px(cx - 1, deskY - 4, 2, 2, w.shirt);
    this.px(cx - 6, deskY, 12, 1, '#8c93a1');
    // tangan
    const typing = w.status === 'building' || (w.status === 'idle' && f % 20 < 6);
    const lh = typing && f % 2 === 0 ? -1 : 0, rh = typing && f % 2 === 1 ? -1 : 0;
    if (!sleeping) {
      this.px(cx - 8, deskY - 1 + lh, 2, 2, w.skin);
      this.px(cx + 6, deskY - 1 + rh, 2, 2, w.skin);
    }
    // barang di meja
    if (w.prop === 0) {
      this.px(cx + 10, deskY - 3, 3, 3, '#a0522d');
      this.px(cx + 10, deskY - 6, 3, 3, '#4fb35f');
    } else if (w.prop === 1) {
      this.px(cx + 10, deskY - 4, 3, 4, '#ffffff');
      this.px(cx + 13, deskY - 3, 1, 2, '#ffffff');
    } else {
      this.px(cx - 13, deskY - 3, 5, 3, '#f4f1e8');
      this.px(cx - 13, deskY - 2, 5, 1, '#d8d3c4');
    }
    this.statusBubble(w, cx, deskY, f);
  }

  statusBubble(w, cx, deskY, f) {
    const bx = cx + 7, by = deskY - 24;
    const box = (border) => {
      this.px(bx, by, 9, 9, border);
      this.px(bx + 1, by + 1, 7, 7, '#ffffff');
      this.px(bx + 1, by + 9, 2, 1, border);
      this.px(bx, by + 10, 1, 1, border);
    };
    switch (w.status) {
      case 'success':
        box('#2e7d32');
        this.glyph('check', bx + 2, by + 2, '#2e7d32');
        break;
      case 'failed':
        if (f % 8 < 6) { box('#c62828'); this.glyph('bang', bx + 2, by + 2, '#c62828'); }
        break;
      case 'building': {
        box('#1565c0');
        const n = f % 4;
        for (let i = 0; i < 3; i++) this.px(bx + 2 + i * 2, by + 4, 1, 1, i < n ? '#1565c0' : '#c7d6ea');
        break;
      }
      case 'sleep': {
        const t = f % 12;
        this.glyph('z', cx + 6 + Math.floor(t / 4), deskY - 16 - Math.floor(t / 2), '#dfe6ff');
        break;
      }
      case 'unknown':
        box('#757575');
        this.glyph('q', bx + 2, by + 2, '#757575');
        break;
      default:
        break;
    }
  }
}
