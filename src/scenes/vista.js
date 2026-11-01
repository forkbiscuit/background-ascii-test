/*
 * Scene: Vista
 * The big view, in two colours: a giant knitted sun filling the sky with
 * hatched rays, cloud streaks across it, a jagged Coast Mountains range with
 * snow left as bare paper, a pocket of valley haze, a pointed fir treeline,
 * and a dense forest of strokes below that slides faster the closer it is.
 *
 * Depth (z), back to front:
 *   0     sky dust          0.005 sun rays      0.01 sun        0.05 streaks
 *   0.08  mountains         0.14  valley haze   0.3  treeline
 *   0.34 → 1  forest (every row has its own depth)
 *
 * The sun sits right of centre so the left of the sky stays clear for text.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;
  const { hash, noise1, noise2, fbm1, ridged1, clamp } = NS.noise;
  const edge = NS.edge;

  const TREELINE = 0.67;                                    // where the forest starts, fraction of height
  const SUN = { x: 0.64, y: 0.6, r: 0.5 };                  // centre + radius (fractions of W, H, H)
  const RAYS = 0.17;                                        // width of the hatched halo, fraction of height
  const forestZ = (rf) => 0.34 + 0.66 * Math.pow(clamp((rf - TREELINE) / (1 - TREELINE), 0, 1), 1.2);

  let cx = 0, cy = 0, R = 0, band = 0;                      // css px, set in setup()
  let clearRows = 0, clearW = 1;

  // Keep the left of the sky clear for the header: peaks that scroll into the
  // left third are scaled down (keeping their shape) so they stay below it.
  function clearTop(top, x) {
    const t = clamp((x / clearW - 0.36) / 0.22, 0, 1);       // 0 on the left -> 1 past ~58% of the width
    const k = 0.48 + 0.52 * (t * t * (3 - 2 * t));
    const base = clearRows;                                   // the treeline, in rows
    return base - (base - top) * k;
  }

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
  const slope = (top, k, rows) => (top(k + 1, rows) - top(k - 1, rows)) / 2;

  // ---- landforms ---------------------------------------------------------------------
  const rangeTop = memo((k) => {
    const massif = 0.6 + 0.4 * fbm1(k * 0.0045, 201, 2);   // where the big peaks cluster
    const jag = ridged1(k * 0.022, 202, 4);                 // sharp, broken summits
    return TREELINE - 0.08 - 0.46 * Math.pow(jag, 1.5) * massif;
  });
  const hazeTop = memo((k) => TREELINE - 0.04 - 0.12 * noise1(k * 0.012, 231) - 0.03 * noise1(k * 0.05, 232));

  // Conifers: height (rows above the treeline) at column k; leaves the offset
  // from the nearest trunk in treeDx.
  let treeDx = 0;
  function conifers(k, seed, spacing, hMin, hMax, steep) {
    let best = 0.8 + 1.4 * noise1(k * 0.09, seed + 5), dx = 99;
    const cell = Math.floor(k / spacing);
    for (let c = cell - 4; c <= cell + 4; c++) {
      const tx = (c + 0.15 + 0.7 * hash(c, 0, seed)) * spacing;
      const th = hMin + (hMax - hMin) * Math.pow(hash(c, 1, seed), 1.4);
      const a = Math.abs(k + 0.5 - tx);
      const h = th - a * steep - ((a * (1.1 + 0.5 * hash(c, 2, seed)) + hash(c, 4, seed)) % 1) * 1.4;
      if (h > best) { best = h; dx = k + 0.5 - tx; }
    }
    treeDx = dx;
    return best;
  }
  const treeData = memo((k) => { const h = conifers(k, 311, 4.2, 4, 15, 2.5); return [h, treeDx]; });

  // A stroke from the forest floor: / \ | leaning with the wind
  function forestStroke(k, r, depth, t, put, seed) {
    const h = hash(k, r, seed);
    const clump = noise2(k * 0.07, r * 0.2, seed + 2);
    const p = (0.78 - 0.25 * depth) * (0.55 + clump);
    if (h > p) return;
    const lean = noise1(k * 0.035 - t * 0.35, seed + 1) + 0.15 * Math.sin(t * 1.2 + k * 0.17 + r * 0.6);
    let ch;
    if (h < p * 0.05) ch = '^';
    else if (h < p * 0.12) ch = h < p * 0.09 ? ',' : "'";
    else ch = lean < 0.42 ? '\\' : lean > 0.68 ? '/' : '|';
    put(ch, 0.75 + 0.25 * clump);
  }

  NS.scenes.vista = {
    title: 'Vista',
    focus: 0.16,                                            // the range and the valley
    glyphs: "\\/|_-^.,'`:=+ox#%─·•v",

    setup(S) {
      cx = S.W * SUN.x; cy = S.H * SUN.y;
      R = SUN.r * Math.min(S.H, S.W * 1.3);                   // smaller on tall phones, so text stays clear
      band = R * (RAYS / SUN.r);
      clearRows = S.rows * TREELINE; clearW = S.W;
      [rangeTop, hazeTop, treeData].forEach((f) => f.clear());
    },

    layers: [
      {
        name: 'sky dust', z: 0, fixed: true, occlude: false, fps: 6, stop: false,
        span(k, S, t, out) { out[0] = 0; out[1] = S.rows * TREELINE; return true; },
        glyph(k, r, d, t, put) {
          const h = hash(k, r, 11);
          if (h < 0.994) return;
          put('·', 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * (0.6 + h) + h * 900)));
        },
      },
      {
        name: 'sun rays', z: 0.005, fixed: true, occlude: false, static: true, stop: false,
        span(k, S, t, out) { out[0] = (cy - R - band) / S.ch; out[1] = cy / S.ch + 1; return true; },
        glyph(k, r, d, t, put, S) {
          if ((k + r) % 3) return;                                // diagonal hatching
          const x = (k + 0.5) * S.cw, y = (r + 0.5) * S.ch;
          const u = (Math.hypot(x - cx, y - cy) - R) / band;      // 0 at the rim -> 1 outside
          if (u < 0.03 || u > 1) return;
          const side = clamp((x - cx) / R * 0.9 + 0.5, 0.15, 1);  // heavier on the right, clear on the left
          if (noise2(k * 0.11, r * 0.11, 8) * side < u * 0.75) return;
          put('/', 0.08 + 0.5 * (1 - u) * side);
        },
      },
      {
        name: 'sun', z: 0.01, fixed: true, occlude: true, static: true, merge: true,
        span(k, S, t, out) {
          const dx = (k + 0.5) * S.cw - cx;
          if (Math.abs(dx) >= R) return false;
          const h = Math.sqrt(R * R - dx * dx);
          out[0] = (cy - h) / S.ch; out[1] = Math.min(S.rows + 2, (cy + h) / S.ch);
          return true;
        },
        glyph(k, r, d, t, put, S) {
          if (hash(k, r, 5) > 0.996) return put('^', 0.8);
          const x = (k + 0.5) * S.cw, y = (r + 0.5) * S.ch;
          const q = Math.hypot(x - cx, y - cy) / R;              // 0 centre -> 1 rim
          const tone = 0.26 + 0.14 * q * q + 0.1 * (noise2(k * 0.06, r * 0.15, 6) - 0.5);
          put(k & 1 ? '/' : '\\', tone);                          // \/\/\/ knit
        },
      },
      {
        name: 'streaks', z: 0.05, occlude: 'cell', static: true, stop: false,
        span(k, S, t, out) { out[0] = S.rows * 0.12; out[1] = S.rows * 0.55; return true; },
        glyph(k, r, d, t, put) {
          const rs = hash(r, 0, 31);
          if (rs > 0.16) return;                                  // only some rows carry a streak
          const n = noise1(k * 0.045 + rs * 997, 32 + r);
          if (n < 0.72 || hash(k, r, 33) < 0.12) return;
          put(n > 0.8 ? '─' : '-', 0.3 + 0.9 * (n - 0.66));
        },
      },
      {
        name: 'mountains', z: 0.08, occlude: true, static: true,
        span(k, S, t, out) {
          const x = k * S.cw - S.layers.mountains.off;
          out[0] = clearTop(rangeTop(k, S.rows), x); out[1] = S.rows * TREELINE + 1;
          return true;
        },
        glyph(k, r, d, t, put, S, x) {
          const rows = S.rows;
          const top = (kk) => clearTop(rangeTop(kk, rows), x + (kk - k) * S.cw);
          if (d < 1) return put(edge((top(k + 1) - top(k - 1)) / 2, d), 1);   // ink outline on the ridgeline
          const s = (top(k + 2) - top(k - 2)) / 4;
          const lit = s < -0.12 ? 2 : s > 0.12 ? 0 : 1;
          const h = hash(k, r, 9);
          const snow = d < 3.5 + 4 * noise1(k * 0.09, 205) && r < rows * (TREELINE - 0.12);
          if (snow) {
            // snow is the paper: strokes down the fall line, heavier in shadow
            const dens = lit === 2 ? 0.14 : lit === 1 ? 0.3 : 0.6;
            if (h < dens) put(s < -0.25 ? '/' : s > 0.25 ? '\\' : ':', lit === 0 ? 0.7 : 0.5);
            return;
          }
          // rock: dense texture under the snow that thins out with depth
          const f = Math.exp(-(d - 3) / 7);
          if (h > 0.18 + 0.7 * f) return;
          if (h < 0.08 * f + 0.02 && Math.abs(s) > 0.4) return put(s > 0 ? '\\' : '/', 0.5 + 0.4 * f);
          const n = noise2(k * 0.14, r * 0.28, 10);
          const v = clamp(0.25 + 0.75 * f * (0.5 + 0.5 * n) + (h - 0.4) * 0.2, 0, 1);
          const RAMP = '.:-=+ox#%';
          put(RAMP[(v * (RAMP.length - 1)) | 0], (0.35 + 0.55 * v) * (lit === 0 ? 1 : 0.85));
        },
      },
      {
        name: 'valley haze', z: 0.14, occlude: true, static: true,
        span(k, S, t, out) { out[0] = hazeTop(k, S.rows); out[1] = S.rows * TREELINE + 1; return true; },
        glyph(k, r, d, t, put) {
          const h = hash(k, r, 23);
          if (d < 1) return h < 0.35 && put('.', 0.35);
          if (h < 0.035) put(h < 0.012 ? '-' : '·', 0.3);
        },
      },
      {
        name: 'treeline', z: 0.3, occlude: true, static: true,
        span(k, S, t, out) { out[0] = S.rows * TREELINE - treeData(k)[0]; out[1] = S.rows * TREELINE + 1; return true; },
        glyph(k, r, d, t, put, S) {
          const dx = treeData(k)[1];
          const h = hash(k, r, 312);
          if (dx === 99) return h < 0.5 && put(h < 0.2 ? ',' : "'", 0.6);
          if (d < 1) return put(Math.abs(dx) < 0.9 ? '^' : dx < 0 ? '/' : '\\', 0.95);
          if (h > 0.82) return;
          put(dx < -0.6 ? '/' : dx > 0.6 ? '\\' : '|', dx < 0 ? 0.7 : 0.9);
        },
      },
      // The forest floor: every row moves at its own speed, densest at the top.
      ...[[TREELINE, 0.74], [0.74, 0.82], [0.82, 0.91], [0.91, 1]].map((b, i) => ({
        name: 'forest ' + (i + 1), band: b, zAt: forestZ, occlude: true, stop: i === 0 || i === 3,
        glyph(k, r, rf, t, put) { forestStroke(k, r, (rf - TREELINE) / (1 - TREELINE), t, put, 51 + i); },
      })),
      {
        name: 'birds', z: 0.2, occlude: false, stop: false,
        custom(S, t, putAt) {
          for (let i = 0; i < 4; i++) {
            const speed = 16 + 8 * hash(i, 0, 601);
            const lane = S.W + 240;
            const x = S.W + 120 - ((hash(i, 1, 601) * 0.3 * lane + t * speed) % lane);
            const row = S.rows * (0.42 + 0.06 * hash(i, 2, 601)) + Math.sin(t * 0.5 + i * 2.1) * 1.1;
            putAt(x, row, Math.sin(t * (5 + i) + i * 3) > -0.3 ? 'v' : '-', 0.85);
          }
        },
      },
    ],
  };
})(window);
