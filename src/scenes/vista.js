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
 *
 * The walk follows a looping route on the ground: fir forest, a clearing with
 * a cabin, a lake with someone fishing off a dock, more forest, a river with
 * someone floating down it on a tube. Route features live on the ground plane
 * (see groundAt), so lakes and rivers widen toward you in true perspective.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;
  const { hash, noise1, noise2, fbm1, ridged1, clamp, smoothstep } = NS.noise;
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
  const TREE_Z = 0.3;
  const treeData = memo((k) => {
    const h = conifers(k, 311, 4.2, 4, 15, 2.5);
    const f = treeFactor(k * cwG / TREE_Z);                   // open ground thins the trees
    return [f < 0.35 ? Math.min(h * f, 1.2 + 1.2 * noise1(k * 0.2, 316)) : h * f, f < 0.35 ? 99 : treeDx];
  });

  // ---- the route ---------------------------------------------------------------------
  // Positions along the walk are in ground px (X). Something at X on a plane at
  // depth z sits at world column k where k * cw = X * z, so screen x = (X - scroll) * z.
  const ROUTE = [['forest', 2200], ['cabin', 3000], ['forest', 1800], ['lake', 5200], ['forest', 1800], ['river', 3600]];
  const ROUTE_LEN = ROUTE.reduce((a, r) => a + r[1], 0);
  const ROUTE_AT = {};                                        // where each stop starts within one loop
  ROUTE.reduce((acc, [type, len]) => { if (!(type in ROUTE_AT)) ROUTE_AT[type] = [acc, len]; return acc + len; }, 0);
  let cwG = 7;                                               // css px per column, set in setup()

  const seg = { type: 'forest', x0: 0, len: 1 };
  function segAt(X) {
    const n = Math.floor(X / ROUTE_LEN);
    let acc = 0;
    const x = X - n * ROUTE_LEN;
    for (let i = 0; i < ROUTE.length; i++) {
      if (x < acc + ROUTE[i][1] || i === ROUTE.length - 1) { seg.type = ROUTE[i][0]; seg.x0 = n * ROUTE_LEN + acc; seg.len = ROUTE[i][1]; return seg; }
      acc += ROUTE[i][1];
    }
    return seg;
  }
  const openness = (X) => smoothstep(0, 450, Math.min(X - seg.x0, seg.x0 + seg.len - X));   // after segAt(X)

  const LAKE = { a: 1150, zm: 0.45, hz: 0.14 };              // half-width in ground px, middle depth, half depth range
  const lakeHalf = (z) => { const v = (z - LAKE.zm) / LAKE.hz; return Math.abs(v) >= 1 ? 0 : LAKE.a * Math.sqrt(1 - v * v); };
  const riverX = (x0, len, z) => x0 + len * 0.5 + 520 * Math.sin((z - 0.3) * 8 + 1);
  const riverHalf = (z) => 70 + 640 * (z - 0.3);
  const CABIN = { at: 0.55, w: 24, wall: 6, roof: 6, z: 0.31 };

  // How much forest the treeline keeps at ground position X (1 = full, 0 = none)
  function treeFactor(X) {
    const s = segAt(X), o = openness(X);
    if (s.type === 'cabin') return 1 - 0.9 * o;
    if (s.type === 'lake') return 1 - 0.75 * o * smoothstep(LAKE.a * 1.1, LAKE.a * 0.6, Math.abs(X - (s.x0 + s.len / 2)));
    if (s.type === 'river') return smoothstep(riverHalf(TREE_Z) + 20, riverHalf(TREE_Z) + 140, Math.abs(X - riverX(s.x0, s.len, TREE_Z)));
    return 1;
  }

  // What covers the ground at X, depth z: 0 forest, 1 meadow, 2 shore, 3 lake, 4 river
  function groundAt(X, z) {
    const s = segAt(X);
    if (s.type === 'forest') return 0;
    const o = openness(X);
    if (s.type === 'river') {
      const d = Math.abs(X - riverX(s.x0, s.len, z)), h = riverHalf(z);
      return d < h ? 4 : d < h + 70 + 60 * z ? 2 : 0;
    }
    if (s.type === 'lake') {
      const d = Math.abs(X - (s.x0 + s.len / 2)), h = lakeHalf(z);
      if (d < h) return 3;
      if (h > 0 && d < h + 90 + 120 * z) return 2;
    }
    return hash(Math.floor(X / 40), Math.floor(z * 200), 77) < o ? 1 : 0;   // meadow fades into forest at the edges
  }

  // ---- ground textures ---------------------------------------------------------------------
  function meadowStroke(k, r, t, put) {
    const h = hash(k, r, 61);
    if (h > 0.2) return;
    const sway = Math.sin(t * 1.1 + k * 0.21 + r) > 0.3;
    put(h < 0.006 ? '*' : h < 0.12 ? (sway ? "'" : ',') : '.', 0.55);
  }
  function shoreStroke(k, r, put) {
    const h = hash(k, r, 62);
    if (h < 0.4) put(h < 0.04 ? 'o' : h < 0.25 ? '.' : ',', 0.6);
  }
  function lakeStroke(X, z, r, t, put) {
    // calm water: horizontal hatching in long runs, with a slow shimmer
    const n = noise2(X * 0.006 + t * 0.04, r * 1.3, 63);
    if (n > 0.38) return put(n > 0.62 ? '─' : '-', 0.32 + 0.5 * (n - 0.38));
    if (hash(Math.floor(X / 6), r, 64 + ((t * 0.7) | 0)) < 0.025) put('~', 0.4);
  }
  function riverStroke(X, z, r, t, put) {
    // moving water: ripples drift downstream (toward you)
    const n = noise2(X * 0.012, z * 90 - t * 1.4, 65);
    if (n > 0.6) put(n > 0.72 ? '~' : '-', 0.55 + 0.5 * (n - 0.6));
    else if (n < 0.18) put('·', 0.35);
  }

  // Screen row for a depth z on the forest floor (inverse of forestZ)
  const rowOfZ = (z, rows) => rows * (TREELINE + (1 - TREELINE) * Math.pow(clamp((z - 0.34) / 0.66, 0, 1), 1 / 1.2));

  // ---- characters (original ASCII figures) ---------------------------------------------
  const FISHER = [
    '.           ',
    '|`.      o  ',
    '|  `.   /|\\ ',
    ':    `-/ |  ',
    '*   ========',
  ];
  // Draw a block of text with its bottom row at `row`, left edge at x.
  function drawArt(putAt, art, x, row, cw, a, swap) {
    const first = art.map((l) => l.search(/\S/)), last = art.map((l) => l.length - 1 - l.split('').reverse().join('').search(/\S/));
    for (let i = 0; i < art.length; i++) {
      const line = art[i];
      for (let j = 0; j < line.length; j++) {
        let ch = line[j];
        if (swap) ch = swap(ch, i, j);
        // spaces inside the figure clear the cell, so the scene doesn't show through
        if (ch === ' ' && (j < first[i] || j > last[i])) continue;
        putAt(x + (j + 0.5) * cw, row - (art.length - 1 - i), ch, ch === ' ' ? 1 : a);
      }
    }
  }

  // Cabin shape, by column offset u from its left wall
  function cabinHeight(u) {
    const half = CABIN.w / 2 + 1;
    const roof = CABIN.wall + CABIN.roof * Math.max(0, 1 - Math.abs(u + 0.5 - CABIN.w / 2) / half);
    const chim = u >= Math.round(CABIN.w * 0.7) && u < Math.round(CABIN.w * 0.7) + 2;
    return chim ? Math.max(roof, CABIN.wall + CABIN.roof * 0.62 + 3) : roof;
  }
  // Left wall column of the cabin near world column k (on the cabin's own plane), or null
  function cabinLeft(k) {
    const X = k * cwG / CABIN.z;
    const s = segAt(X);
    if (s.type !== 'cabin') return null;
    const kc = Math.round((s.x0 + s.len * CABIN.at) * CABIN.z / cwG);
    const u = k - (kc - CABIN.w / 2);
    return u >= -1 && u <= CABIN.w ? kc - CABIN.w / 2 : null;
  }

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
    focus: 0.3,                                             // the treeline, cabin and fisher
    // open on the lake, with the fisher a little right of centre (works at any width)
    start: (S) => ROUTE_AT.lake[0] + ROUTE_AT.lake[1] / 2 + lakeHalf(LAKE.zm) - 60 - (S.W * (S.W < 640 ? 0.75 : 0.62)) / LAKE.zm,
    glyphs: "\\/|_-^.,'`:=+ox#%─·•v~*()□■",

    setup(S) {
      cx = S.W * SUN.x; cy = S.H * SUN.y;
      R = SUN.r * Math.min(S.H, S.W * 1.3);                   // smaller on tall phones, so text stays clear
      band = R * (RAYS / SUN.r);
      clearRows = S.rows * TREELINE; clearW = S.W;
      cwG = S.cw;
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
      {
        name: 'cabin', z: CABIN.z, occlude: true, static: true,
        span(k, S, t, out) {
          const l = cabinLeft(k);
          if (l === null) return false;
          out[0] = S.rows * TREELINE - cabinHeight(k - l); out[1] = S.rows * TREELINE + 1;
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const u = k - cabinLeft(k), W = CABIN.w;
          const up = S.rows * TREELINE - r;                       // rows above the ground
          if (up > CABIN.wall) {
            const chim = u >= Math.round(W * 0.7) && u < Math.round(W * 0.7) + 2;
            if (chim && up > CABIN.wall + CABIN.roof * Math.max(0, 1 - Math.abs(u + 0.5 - W / 2) / (W / 2 + 1)) - 0.5) return put('■', 0.95);
            if (d < 1) return put(u + 0.5 < W / 2 ? '/' : '\\', 0.95);   // roof edges
            return put(hash(k, r, 411) < 0.15 ? '-' : '=', 0.85);      // shingles
          }
          if (u < 0 || u >= W) return;                            // under the eaves
          if (u === 0 || u === W - 1) return put('|', 0.95);
          if (up > CABIN.wall - 0.5) return put('─', 0.95);          // eave line
          const door = Math.abs(u + 0.5 - W / 2) < 2;
          if (door) return up < 4.5 && put(Math.abs(u + 0.5 - W / 2) > 1 ? '|' : ' ', 0.95);
          const win = (u >= 3 && u <= 6) || (u >= W - 7 && u <= W - 4);
          if (win && up >= 2.5 && up < 4.5) return put('□', 0.95);
          if (hash(k, r, 412) < 0.85) put(hash(k, r, 413) < 0.08 ? '=' : '─', 0.85);   // log walls
        },
      },
      {
        name: 'smoke', z: CABIN.z, occlude: false, stop: false, merge: true,
        custom(S, t, putAt) {
          const L = S.layers.cabin;
          const [c0] = ROUTE_AT.cabin;
          const n0 = Math.floor((L.off / CABIN.z) / ROUTE_LEN) - 1;
          for (let n = n0; n <= n0 + 2; n++) {
            const kc = Math.round((n * ROUTE_LEN + c0 + ROUTE_AT.cabin[1] * CABIN.at) * CABIN.z / S.cw);
            const cx = (kc - CABIN.w / 2 + Math.round(CABIN.w * 0.7) + 1) * S.cw - L.off;
            if (cx < -200 || cx > S.W + 200) continue;
            const top = S.rows * TREELINE - (CABIN.wall + CABIN.roof * 0.62 + 3);
            for (let i = 0; i < 10; i++) {                        // puffs drifting up and off with the wind
              const row = top - 1 - i * 1.1;
              const x = cx + i * S.cw * 0.7 + Math.sin(t * 1.3 + i * 0.8) * S.cw * (0.4 + i * 0.15);
              const m = 1 + ((i / 3) | 0);
              for (let j = 0; j < m; j++) {
                if (hash(n * 31 + i, j, (t * 4) | 0) < 0.3) continue;
                putAt(x + (j - m / 2) * S.cw, row, '•=─·'[(i + j + ((t * 3) | 0)) % 4], (1 - i / 10) * 0.75);
              }
            }
          }
        },
      },
      // The forest floor: every row moves at its own speed, densest at the top.
      ...[[TREELINE, 0.74], [0.74, 0.82], [0.82, 0.91], [0.91, 1]].map((b, i) => ({
        name: 'forest ' + (i + 1), band: b, zAt: forestZ, occlude: true, stop: i === 0 || i === 3,
        glyph(k, r, rf, t, put, S) {
          const z = forestZ(rf), X = k * S.cw / z;
          const gnd = groundAt(X, z);
          if (gnd === 0) return forestStroke(k, r, (rf - TREELINE) / (1 - TREELINE), t, put, 51 + i);
          if (gnd === 1) return meadowStroke(k, r, t, put);
          if (gnd === 2) return shoreStroke(k, r, put);
          if (gnd === 3) return lakeStroke(X, z, r, t, put);
          riverStroke(X, z, r, t, put);
        },
      })),
      {
        // someone fishing off a little dock on the far side of the lake
        name: 'fisher', z: LAKE.zm, occlude: 'cell',
        custom(S, t, putAt) {
          const L = S.layers.fisher, z = LAKE.zm;
          const [l0, llen] = ROUTE_AT.lake;
          const n0 = Math.floor((L.off / z) / ROUTE_LEN) - 1;
          for (let n = n0; n <= n0 + 2; n++) {
            const X = n * ROUTE_LEN + l0 + llen / 2 + lakeHalf(z) - 60;   // dock reaches into the water
            const x = X * z - L.off;
            if (x < -200 || x > S.W + 100) continue;
            const row = Math.round(rowOfZ(z, S.rows));
            const bob = Math.sin(t * 2.2) > 0.2;
            drawArt(putAt, FISHER, x - 4 * S.cw, row, S.cw, 0.95, (ch, i) =>
              ch === '*' ? (bob ? '•' : 'o') : ch === ':' ? (bob ? ':' : '|') : ch);
            if (Math.sin(t * 2.2 + 1) > 0.6) putAt(x - 4 * S.cw - S.cw * 0.5, row, '(', 0.5), putAt(x - 4 * S.cw + S.cw * 1.5, row, ')', 0.5);
          }
        },
      },
      {
        // someone on an inner tube, drifting down the river toward you
        name: 'tuber', z: 0.5, occlude: 'cell',
        custom(S, t, putAt) {
          const L = S.layers.tuber;
          const [r0, rlen] = ROUTE_AT.river;
          const p = (t / 70) % 1;                                  // drifts from far to near, then again
          const z = 0.4 + 0.42 * p;
          const offZ = L.off * z / L.def.z;                        // the scroll offset at this depth
          const n0 = Math.floor((offZ / z) / ROUTE_LEN) - 1;
          const wave = Math.sin(t * 2.5) > 0;
          for (let n = n0; n <= n0 + 2; n++) {
            const X = riverX(n * ROUTE_LEN + r0, rlen, z) + Math.sin(t * 0.6) * 25;
            const x = X * z - offZ;
            if (x < -100 || x > S.W + 100) continue;
            const row = Math.round(rowOfZ(z, S.rows));
            const art = [wave ? ' \\o_ ' : ' _o/ ', '(___)', p * 10 % 2 < 1 ? ' ~ ~ ' : '~ ~ ~'];
            drawArt(putAt, art, x - 2.5 * S.cw, row + 1, S.cw, 0.95);
          }
        },
      },
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
