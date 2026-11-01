/*
 * Scene: BC
 * A side-scrolling walk through the British Columbia backcountry in two
 * colours, drawn in "ruled" ASCII: every surface is made of horizontal rules
 * broken by gaps and sprinkled with symbols (─ • = □ ■ 0-9).
 *
 * Snow-capped Coast Mountains, forested foothills, a fir forest line, tall
 * Douglas firs and the odd cabin with chimney smoke scrolling past, cloud
 * banks hanging from the top, and a ruled ground strip where every row moves
 * at its own speed.
 *
 * Depth (z), back to front:
 *   0.015 cloud banks     0.025 small clouds     0.03 mountains   0.07 foothills
 *   0.14  forest line     0.4   firs + cabins + smoke             0.42 → 1 ground
 *
 * Distance is shown by how faint the ink is; depth of field blurs whatever is
 * away from the focus depth.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;
  const { hash, noise1, fbm1, ridged1, clamp } = NS.noise;
  const edge = NS.edge;

  const GROUND = 0.74;                                      // top of the ground strip, fraction of height
  const groundZ = (rf) => 0.42 + 0.58 * Math.pow(clamp((rf - GROUND) / (1 - GROUND), 0, 1), 1.2);
  const SYM = '•=□-0123456789•=■─';

  // Cache a per-column value; shapes are stored as a fraction of height.
  function memo(fn) {
    const m = new Map();
    const f = (k, rows) => {
      let v = m.get(k);
      if (v === undefined) {
        v = fn(k);
        if (m.size > 40000) m.clear();
        m.set(k, v);
      }
      return rows === undefined ? v : v * rows;
    };
    f.clear = () => m.clear();
    return f;
  }

  // One cell of a ruled surface: a horizontal rule broken into runs, with the
  // odd symbol dropped in. dens = how much of the row is rule, sym = symbol share.
  function rule(k, r, put, a, dens, sym, seed) {
    if (noise1(k * 0.17 + r * 7.31, seed) < 1 - dens) return;
    const h = hash(k, r, seed + 1);
    put(h < sym ? SYM[(hash(k, r, seed + 2) * SYM.length) | 0] : '─', a);
  }

  // ---- landforms ---------------------------------------------------------------------
  const rangeTop = memo((k) => {
    const massif = 0.4 + 0.6 * fbm1(k * 0.0035, 201, 2);   // where the big peaks cluster
    const jag = ridged1(k * 0.02, 202, 4);
    return GROUND - (0.1 + 0.5 * Math.pow(jag, 1.8) * massif);
  });
  const footTop = memo((k) => GROUND - (0.03 + 0.11 * Math.pow(ridged1(k * 0.028, 211, 3), 1.4)));
  const slope = (top, k, rows) => (top(k + 1, rows) - top(k - 1, rows)) / 2;

  // ---- conifers ----------------------------------------------------------------------
  // Height (rows above the ground) of a row of conifers at column k; leaves the
  // offset from the nearest trunk in treeDx and that tree's height in treeH.
  let treeDx = 0, treeH = 0;
  function conifers(k, seed, spacing, hMin, hMax, presence, steep) {
    let best = 0, dx = 99, th0 = 0;
    const cell = Math.floor(k / spacing);
    for (let c = cell - 4; c <= cell + 4; c++) {
      // trees grow in stands: presence follows a slow noise, not a coin flip
      if (noise1(c * 0.21, seed + 7) * 0.6 + hash(c, 3, seed) * 0.4 > presence) continue;
      const tx = (c + 0.15 + 0.7 * hash(c, 0, seed)) * spacing;
      const th = hMin + (hMax - hMin) * Math.pow(hash(c, 1, seed), 1.1);
      const a = Math.abs(k + 0.5 - tx);
      // narrow cone; the sawtooth makes ragged tiers of branches, a little
      // different on each tree
      const tier = 1.1 + 0.5 * hash(c, 2, seed);
      const h = th - a * steep - ((a * tier + hash(c, 4, seed)) % 1) * 1.8;
      if (h > best) { best = h; dx = k + 0.5 - tx; th0 = th; }
    }
    treeDx = dx; treeH = th0;
    return best;
  }
  const forestData = memo((k) => { const h = conifers(k, 311, 2.6, 4, 12, 0.9, 2.8); return [Math.max(1 + 1.5 * noise1(k * 0.08, 305), h), h > 1 ? treeDx : 99]; });
  const firData = memo((k) => { const h = conifers(k, 321, 11, 14, 34, 0.5, 2.9); return [h, treeDx, treeH]; });

  // ---- cabins ------------------------------------------------------------------------
  const CABIN = { every: 380, w: 24, wall: 6, roof: 6 };
  // Returns null or { x0, u } where u is the column offset inside the cabin.
  function cabinAt(k) {
    const cell = Math.floor(k / CABIN.every);
    for (let c = cell - 1; c <= cell; c++) {
      if (hash(c, 0, 401) > 0.55) continue;
      const x0 = Math.floor(c * CABIN.every + 40 + hash(c, 1, 401) * (CABIN.every - CABIN.w - 80));
      if (k >= x0 - 1 && k <= x0 + CABIN.w) return { x0, u: k - x0 };
    }
    return null;
  }
  // height (rows above the ground) of the cabin's roofline at offset u
  function cabinHeight(u) {
    const half = CABIN.w / 2 + 1;
    const roof = CABIN.wall + CABIN.roof * Math.max(0, 1 - Math.abs(u + 0.5 - CABIN.w / 2) / half);
    const chim = u >= Math.round(CABIN.w * 0.7) && u < Math.round(CABIN.w * 0.7) + 2;
    return chim ? Math.max(roof, CABIN.wall + CABIN.roof * 0.62 + 3) : roof;
  }

  // ---- clouds ------------------------------------------------------------------------
  const bankBottom = memo((k) => {
    const clump = noise1(k * 0.011, 501);
    if (clump < 0.6) return -9;
    return 0.035 + 0.2 * (clump - 0.6) / 0.4;               // hangs from the top of the screen
  });
  const puff = memo((k) => {
    const p = noise1(k * 0.045, 511);
    return p < 0.76 ? 0 : (p - 0.76) / 0.24;
  });

  NS.scenes.bc = {
    title: 'BC',
    focus: 0.34,                                            // the firs and cabins
    start: 215,                                             // open with a cabin in view
    glyphs: "─-·•=□■.,:'^_|/\\v0123456789",

    setup() {
      [rangeTop, footTop, forestData, firData, bankBottom, puff].forEach((f) => f.clear());
    },

    layers: [
      {
        name: 'cloud banks', z: 0.015, occlude: true, static: true,
        span(k, S, t, out) {
          const b = bankBottom(k);
          if (b < 0) return false;
          out[0] = -2;
          out[1] = S.rows * b + 2.2 * noise1(k * 0.33, 502) + 1.4 * hash(k, 0, 503);   // ragged underside
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const h = hash(k, r, 504);
          const fromBottom = S.rows * bankBottom(k) + 2 - r;
          if (fromBottom < 3 && h > 0.55) return;              // thins out at the bottom
          if (h < 0.26) put('■', 0.85);
          else if (h < 0.48) put('=', 0.8);
          else if (h < 0.6) put('•', 0.8);
          else if (h < 0.86) put('─', 0.75);
        },
      },
      {
        name: 'small clouds', z: 0.025, occlude: 'cell', static: true, stop: false, merge: true,
        span(k, S, t, out) {
          const p = puff(k);
          if (!p) return false;
          const mid = S.rows * (0.3 + 0.08 * noise1(k * 0.01, 512));
          out[0] = mid - 0.6 - p * 1.6; out[1] = mid + 0.6 + p * 0.8;
          return true;
        },
        glyph(k, r, d, t, put) {
          const h = hash(k, r, 513);
          if (h < 0.3) put('■', 0.7); else if (h < 0.55) put('=', 0.65); else if (h < 0.85) put('─', 0.6);
        },
      },
      {
        name: 'mountains', z: 0.03, occlude: true, static: true,
        span(k, S, t, out) { out[0] = rangeTop(k, S.rows); out[1] = S.rows * GROUND + 1; return true; },
        glyph(k, r, d, t, put, S) {
          if (d < 1) return put(edge(slope(rangeTop, k, S.rows), d), 0.9);
          const snowline = S.rows * (GROUND - 0.2 + 0.05 * noise1(k * 0.03, 205));
          const snow = d < 3 || (r < snowline && d < 7 + 6 * noise1(k * 0.1, 206));
          // snow: clean, sparse rules; rock: denser rules with symbols
          if (snow) return r % 2 === 0 && rule(k, r, put, 0.5, 0.5, 0, 207);
          rule(k, r, put, 0.65, 0.85, 0.16, 208);
        },
      },
      {
        name: 'foothills', z: 0.07, occlude: true, static: true,
        span(k, S, t, out) { out[0] = footTop(k, S.rows); out[1] = S.rows * GROUND + 1; return true; },
        glyph(k, r, d, t, put, S) {
          if (d < 1) return put(edge(slope(footTop, k, S.rows), d), 0.8);
          rule(k, r, put, 0.6, 0.85, 0.2, 212);
        },
      },
      {
        name: 'forest line', z: 0.14, occlude: true, static: true,
        span(k, S, t, out) { out[0] = S.rows * GROUND - forestData(k)[0]; out[1] = S.rows * GROUND + 1; return true; },
        glyph(k, r, d, t, put) {
          const dx = forestData(k)[1];
          if (d < 1) return put(Math.abs(dx) < 0.8 ? '^' : '-', 0.7);
          rule(k, r, put, 0.62, 0.92, 0.2, 314);
        },
      },
      {
        name: 'birds', z: 0.3, occlude: false, stop: false,
        custom(S, t, putAt) {
          for (let i = 0; i < 4; i++) {
            const speed = 18 + 8 * hash(i, 0, 601);
            const lane = S.W + 240;
            const x = S.W + 120 - ((hash(i, 1, 601) * 0.3 * lane + t * speed) % lane);
            const row = S.rows * (0.36 + 0.05 * hash(i, 2, 601)) + Math.sin(t * 0.5 + i * 2.1) * 1.1;
            putAt(x, row, Math.sin(t * (5 + i) + i * 3) > -0.3 ? 'v' : '-', 0.85);
          }
        },
      },
      {
        name: 'firs', z: 0.4, occlude: true, static: true,
        span(k, S, t, out) {
          const [h] = firData(k);
          if (h < 1) return false;
          out[0] = S.rows * GROUND - h; out[1] = S.rows * GROUND + 1;
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const [h, dx, th] = firData(k);
          if (d < 1) return put(Math.abs(dx) < 1 ? '^' : dx < 0 ? '/' : '\\', 0.95);
          const fromTop = r - (S.rows * GROUND - th);              // rows down from the tree's tip
          const halfW = fromTop / 2.9;
          if (Math.abs(dx) > halfW - 1.2) return put(hash(k, r, 322) < 0.5 ? '-' : '•', 0.9);   // branch tips
          rule(k, r, put, 0.95, 0.94, 0.26, 323);                // tiers of branches
        },
      },
      {
        name: 'cabins', z: 0.41, occlude: true, static: true,
        span(k, S, t, out) {
          const c = cabinAt(k);
          if (!c) return false;
          out[0] = S.rows * GROUND - cabinHeight(c.u); out[1] = S.rows * GROUND + 1;
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const { u } = cabinAt(k);
          const up = S.rows * GROUND - r;                          // rows above the ground
          const W = CABIN.w;
          if (up > CABIN.wall) {
            const roofTop = cabinHeight(u);
            const chim = u >= Math.round(W * 0.7) && u < Math.round(W * 0.7) + 2;
            if (chim && up > CABIN.wall + CABIN.roof * Math.max(0, 1 - Math.abs(u + 0.5 - W / 2) / (W / 2 + 1)) - 0.5) return put('■', 0.95);
            if (d < 1) return put(u + 0.5 < W / 2 ? '/' : '\\', 0.95);   // roof edges
            return put(hash(k, r, 411) < 0.15 ? '-' : '=', 0.85);       // shingles
          }
          if (u < 0 || u >= W) return;                             // under the eaves
          if (u === 0 || u === W - 1) return put('|', 0.95);
          if (up > CABIN.wall - 0.5) return put('─', 0.95);           // eave line
          const door = Math.abs(u + 0.5 - W / 2) < 2;
          if (door) return up < 4.5 && put(Math.abs(u + 0.5 - W / 2) > 1 ? '|' : ' ', 0.95);
          const win = (u >= 3 && u <= 6) || (u >= W - 7 && u <= W - 4);
          if (win && up >= 2.5 && up < 4.5) return put('□', 0.95);
          rule(k, r, put, 0.9, 1, 0.08, 412);                       // log walls
        },
      },
      {
        name: 'smoke', z: 0.41, occlude: false, stop: false, merge: true,
        custom(S, t, putAt) {
          const L = S.layers.cabins;
          const k0 = Math.floor(L.off / S.cw) - 30, k1 = k0 + S.cols + 60;
          for (let c = Math.floor(k0 / CABIN.every) - 1; c <= Math.floor(k1 / CABIN.every); c++) {
            if (hash(c, 0, 401) > 0.55) continue;
            const x0 = Math.floor(c * CABIN.every + 40 + hash(c, 1, 401) * (CABIN.every - CABIN.w - 80));
            const cx = (x0 + Math.round(CABIN.w * 0.7) + 1) * S.cw - L.off;
            const top = S.rows * GROUND - (CABIN.wall + CABIN.roof * 0.62 + 3);
            // a column of puffs drifting up and off with the wind
            for (let i = 0; i < 10; i++) {
              const life = (t * 0.9 + i * 0.37) % 1;
              const row = top - 1 - i * 1.1;
              const x = cx + i * S.cw * 0.7 + Math.sin(t * 1.3 + i * 0.8) * S.cw * (0.4 + i * 0.15);
              const a = (1 - i / 10) * 0.75;
              const n = 1 + ((i / 3) | 0);
              for (let j = 0; j < n; j++) {
                const ch = '•=─·'[(i + j + ((t * 3) | 0)) % 4];
                if (hash(c * 31 + i, j, (t * 4) | 0) < 0.25 + life * 0.2) continue;
                putAt(x + (j - n / 2) * S.cw, row, ch, a);
              }
            }
          }
        },
      },
      // The ground: ruled rows, each moving at its own speed.
      ...[[GROUND, 0.8], [0.8, 0.87], [0.87, 0.94], [0.94, 1]].map((band, i) => ({
        name: 'ground ' + (i + 1), band, zAt: groundZ, occlude: true, stop: i === 0 || i === 3,
        glyph(k, r, rf, t, put, S) {
          const first = r === Math.round(S.rows * GROUND);
          rule(k, r, put, 0.9, first ? 0.97 : 0.86, first ? 0.3 : 0.2, 700 + i * 10);
        },
      })),
    ],
  };
})(window);
