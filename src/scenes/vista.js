/*
 * Scene: Vista
 * The big view, in two colours: a giant knitted sun filling the sky with
 * hatched rays, cloud streaks across it, a far range fading into haze, a
 * jagged Coast Mountains range with a nearer spur ridge, snow left as bare
 * paper, valley haze, a tiered fir treeline, and a dense forest of strokes
 * below that slides faster the closer it is.
 *
 * The walk follows a looping route on the ground: fir forest, a clearing with
 * a log cabin and a woodpile, a lake that mirrors the mountains with someone
 * fishing off a dock, more forest, and a river with someone floating down it
 * on a tube. Route features live on the ground plane (see groundAt), so lakes
 * and rivers widen toward you in true perspective.
 *
 * Depth (z), back to front:
 *   0     sky dust          0.005 sun rays      0.01 sun        0.035 streaks
 *   0.045 far range         0.08  mountains     0.14 valley haze
 *   0.3   treeline, cabin   0.34 → 1  ground (every row has its own depth)
 *
 * Small type (8px) for detail. Shapes are designed at 12px and scaled by Z,
 * so they keep their size while getting more characters.
 * The sun sits right of centre so the left of the sky stays clear for text.
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
  const rowOfZ = (z, rows) => rows * (TREELINE + (1 - TREELINE) * Math.pow(clamp((z - 0.34) / 0.66, 0, 1), 1 / 1.2));

  let cx = 0, cy = 0, R = 0, band = 0;                      // sun, css px
  let clearRows = 0, clearW = 1, cwG = 7;
  let Z = 1;                                                // characters per design unit

  function memo(fn) {
    const m = new Map();
    const f = (k, rows) => {
      let v = m.get(k);
      if (v === undefined) {
        v = fn(k);
        if (m.size > 60000) m.clear();
        m.set(k, v);
      }
      return rows === undefined ? v : v * rows;
    };
    f.clear = () => m.clear();
    return f;
  }

  // Keep the left of the sky clear for the header: peaks that scroll into the
  // left third are scaled down (keeping their shape) so they stay below it.
  function clearTop(top, x) {
    const t = clamp((x / clearW - 0.36) / 0.22, 0, 1);
    const k = 0.48 + 0.52 * (t * t * (3 - 2 * t));
    return clearRows - (clearRows - top) * k;
  }

  // ---- landforms (top edge as a fraction of height; u = column in design units) ----------
  const farTop = memo((k) => {
    const u = k / Z;
    const massif = 0.45 + 0.55 * fbm1(u * 0.003, 241, 2);
    return TREELINE - 0.12 - 0.3 * Math.pow(ridged1(u * 0.013, 242, 4), 1.4) * massif;
  });
  const rangeTop = memo((k) => {
    const u = k / Z;
    const massif = 0.6 + 0.4 * fbm1(u * 0.0045, 201, 2);    // where the big peaks cluster
    const jag = ridged1(u * 0.022, 202, 4);                 // sharp, broken summits
    return TREELINE - 0.08 - 0.46 * Math.pow(jag, 1.5) * massif;
  });
  const spurTop = memo((k) => {                             // a nearer, lower ridge in front of the range
    const u = k / Z;
    return TREELINE - 0.05 - 0.25 * Math.pow(ridged1(u * 0.034, 251, 3), 1.6) * (0.4 + 0.6 * fbm1(u * 0.006, 252, 2));
  });
  const hazeTop = memo((k) => { const u = k / Z; return TREELINE - 0.04 - 0.12 * noise1(u * 0.012, 231) - 0.03 * noise1(u * 0.05, 232); });

  // ---- the route ---------------------------------------------------------------------
  // Positions along the walk are in ground px (X). Something at X on a plane at
  // depth z sits at world column k where k * cw = X * z, so screen x = (X - scroll) * z.
  const ROUTE = [['forest', 2200], ['cabin', 3000], ['forest', 1800], ['lake', 5200], ['forest', 1800], ['river', 3600]];
  const ROUTE_LEN = ROUTE.reduce((a, r) => a + r[1], 0);
  const ROUTE_AT = {};                                        // where each stop starts within one loop
  ROUTE.reduce((acc, [type, len]) => { if (!(type in ROUTE_AT)) ROUTE_AT[type] = [acc, len]; return acc + len; }, 0);

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
  const TREE_Z = 0.3;

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

  // ---- fir trees ---------------------------------------------------------------------------
  // Height (rows above the treeline) of the tallest tree at column k. Leaves the
  // offset from that tree's trunk in treeDx (99 = undergrowth) and its height in treeTh.
  let treeDx = 0, treeTh = 0;
  function conifers(k, seed, spacing, hMin, hMax, steep) {
    let best = (0.8 + 1.4 * noise1(k / Z * 0.09, seed + 5)) * Z, dx = 99, th0 = 0;
    const cell = Math.floor(k / spacing);
    for (let c = cell - 4; c <= cell + 4; c++) {
      const tx = (c + 0.15 + 0.7 * hash(c, 0, seed)) * spacing;
      const th = hMin + (hMax - hMin) * Math.pow(hash(c, 1, seed), 1.4);
      const a = Math.abs(k + 0.5 - tx);
      // narrow cone; the sawtooth makes tiers of branches
      const h = th - a * steep - ((a / Z * (1.1 + 0.5 * hash(c, 2, seed)) + hash(c, 4, seed)) % 1) * 1.4 * Z;
      if (h > best) { best = h; dx = k + 0.5 - tx; th0 = th; }
    }
    treeDx = dx; treeTh = th0;
    return best;
  }
  const treeData = memo((k) => {
    const h = conifers(k, 311, 4.2 * Z, 4 * Z, 15 * Z, 2.5);
    const f = treeFactor(k * cwG / TREE_Z);                   // open ground thins the trees
    if (f < 0.35) return [Math.min(h * f, (1.2 + 1.2 * noise1(k / Z * 0.2, 316)) * Z), 99, 0];
    return [h * f, treeDx, treeTh * f];
  });

  // ---- ground textures ---------------------------------------------------------------------
  function forestStroke(k, r, depth, t, put, seed) {
    const u = k / Z, v = r / Z;
    const h = hash(k, r, seed);
    const clump = noise2(u * 0.07, v * 0.2, seed + 2);
    const p = (0.78 - 0.25 * depth) * (0.55 + clump);
    if (h > p) return;
    const lean = noise1(u * 0.035 - t * 0.35, seed + 1) + 0.15 * Math.sin(t * 1.2 + u * 0.17 + v * 0.6);
    let ch;
    if (h < p * 0.05) ch = '^';
    else if (h < p * 0.12) ch = h < p * 0.09 ? ',' : "'";
    else ch = lean < 0.42 ? '\\' : lean > 0.68 ? '/' : '|';
    put(ch, 0.75 + 0.25 * clump);
  }
  // open meadow: short tufts in the distance, tall grass blades up close
  function meadowStroke(k, r, depth, t, put) {
    const h = hash(k, r, 61);
    const clump = noise2(k / Z * 0.05, r / Z * 0.3, 66);
    if (h > (0.1 + 0.55 * depth * depth) * (0.4 + clump)) return;
    const sway = Math.sin(t * 1.1 + k / Z * 0.21 + r * 0.3);
    if (depth < 0.35) return put(h < 0.006 ? '*' : h < 0.08 ? (sway > 0.3 ? "'" : ',') : '.', 0.6);
    put(h < 0.01 ? '*' : sway > 0.35 ? '/' : sway < -0.35 ? '\\' : h < 0.05 ? "'" : '|', 0.6 + 0.3 * clump);
  }
  function shoreStroke(k, r, put) {
    const h = hash(k, r, 62);
    if (h < 0.4) put(h < 0.04 ? 'o' : h < 0.25 ? '.' : ',', 0.6);
  }

  // What's above the waterline at screen (x, row)? Returns how dark it is (0..1).
  function mirrorAt(x, row, S) {
    const L = S.layers, rows = S.rows;
    const col = (name) => Math.floor((x + L[name].off) / S.cw);
    let k = col('treeline');
    if (row >= rows * TREELINE - treeData(k)[0]) return treeData(k)[1] === 99 ? 0.4 : 0.9;
    if (row >= hazeTop(col('valley haze'), rows)) return 0.12;
    k = col('mountains');
    let top = clearTop(rangeTop(k, rows), x);
    if (row >= top) return row - top < 4 * Z && row < rows * (TREELINE - 0.12) ? 0.15 : 0.6;
    k = col('far range');
    top = clearTop(farTop(k, rows), x);
    if (row >= top) return 0.3;
    const y = (row + 0.5) * S.ch;
    if ((x - cx) ** 2 + (y - cy) ** 2 < R * R) return 0.35;
    return 0.05;
  }
  function lakeStroke(X, z, k, r, t, put, S, x) {
    // the lake mirrors the treeline and mountains, broken up by slow ripples
    const hr = S.rows * TREELINE;
    const depth = (r - hr) / (S.rows - hr);
    const wob = Math.sin(r * 1.37 + t * 1.1) * S.cw * (0.5 + 2.5 * depth);
    const dark = mirrorAt(x + wob, hr - (r + 0.5 - hr) * 1.25, S);
    const n = noise2(X * 0.006 + t * 0.04, r / Z * 1.3, 63);
    const on = n + dark * 0.55;
    if (on > 0.72) return put(dark > 0.7 ? '=' : dark > 0.4 ? '─' : '-', 0.3 + 0.6 * dark);
    if (on > 0.5) return put(dark > 0.4 ? '-' : '·', 0.25 + 0.4 * dark);
    if (hash(Math.floor(X / 6), r, 64 + ((t * 0.7) | 0)) < 0.02) put('~', 0.4);
  }
  function riverStroke(X, z, r, t, put) {
    // moving water: ripples drift downstream (toward you)
    const n = noise2(X * 0.012, z * 90 - t * 1.4, 65);
    if (n > 0.6) put(n > 0.72 ? '~' : '-', 0.55 + 0.5 * (n - 0.6));
    else if (n < 0.18) put('·', 0.35);
  }

  // ---- cabin -------------------------------------------------------------------------------
  // Designed in 12px units (columns x rows) and scaled by Z.
  const CABIN = { at: 0.55, w: 28, wall: 8, roof: 8, z: 0.31, chim: 0.72 };
  const roofAt = (U) => CABIN.wall + CABIN.roof * Math.max(0, 1 - Math.abs(U - CABIN.w / 2) / (CABIN.w / 2 + 2));
  const isChimney = (U) => U >= CABIN.w * CABIN.chim && U < CABIN.w * CABIN.chim + 2.4;
  const pileAt = (U) => Math.max(0, 3.2 - Math.abs(U - (CABIN.w + 7)) * 0.75);   // a woodpile to the right
  // Height (design rows) at design column U from the left wall
  function cabinHeight(U) {
    let h = U >= -2.5 && U < CABIN.w + 2.5 ? roofAt(U) : 0;
    if (isChimney(U)) h = Math.max(h, CABIN.wall + CABIN.roof * 0.6 + 4);
    return Math.max(h, pileAt(U));
  }
  // Left wall column of the cabin near world column k, or null
  function cabinLeft(k) {
    const X = k * cwG / CABIN.z;
    const s = segAt(X);
    if (s.type !== 'cabin') return null;
    const left = Math.round((s.x0 + s.len * CABIN.at) * CABIN.z / cwG - CABIN.w * Z / 2);
    const U = (k - left) / Z;
    return U >= -3 && U < CABIN.w + 12 && cabinHeight(U + 0.5 / Z) > 0.3 ? left : null;
  }

  // ---- characters (original ASCII figures) ---------------------------------------------
  // Someone fishing off the end of a dock; the line hangs from the rod tip to a bobber.
  const FISHER = [
    '.                          ',
    '|`-.                       ',
    '|   `-.                    ',
    ':      `-.        _n_      ',
    ':         `-.    (_ )      ',
    ':            `-._/| \\      ',
    ':                 |  |     ',
    ':             _____\\_|_____',
    '*            |=============',
    '                ||       ||',
  ];
  // Someone on an inner tube, waving
  const TUBER = [
    ['    \\o/    ', '     o/    '],
    ['  .-\'|\'-.  ', '  .-\'|\'-.  '],
    [' (   ^   ) ', ' (   ^   ) '],
    ['  `-...-\'  ', '  `-...-\'  '],
  ];
  // Draw a block of text with its bottom row at `row`, left edge at x.
  function drawArt(putAt, art, x, row, cw, a, swap) {
    for (let i = 0; i < art.length; i++) {
      const line = art[i];
      const first = line.search(/\S/), last = line.length - 1 - line.split('').reverse().join('').search(/\S/);
      for (let j = 0; j < line.length; j++) {
        let ch = line[j];
        if (swap) ch = swap(ch, i, j);
        // spaces inside the figure clear the cell, so the scene doesn't show through
        if (ch === ' ' && (j < first || j > last)) continue;
        putAt(x + (j + 0.5) * cw, row - (art.length - 1 - i), ch, ch === ' ' ? 1 : a);
      }
    }
  }

  const GLYPHS = Array.from(new Set("\\/|_-^.,'`:=+ox#%─·•v~*()[]n" + FISHER.join('') + TUBER.flat().join(''))).join('');

  NS.scenes.vista = {
    title: 'Vista',
    fontSize: 8,                                            // small type = more detail
    fontSizeSmall: 7,
    fontWeight: 600,                                        // heavier strokes hold up at small sizes
    inkGamma: 0.72,                                         // and faint strokes get a little darker
    blurScale: 0.75,
    focus: 0.3,                                             // the treeline, cabin and fisher
    // open on the lake, with the fisher a little right of centre (works at any width)
    start: (S) => ROUTE_AT.lake[0] + ROUTE_AT.lake[1] / 2 + lakeHalf(LAKE.zm) - 110 - (S.W * (S.W < 640 ? 0.78 : 0.6)) / LAKE.zm,
    glyphs: GLYPHS,

    setup(S) {
      Z = (S.W < 640 ? 10 : 12) / S.fontSize;
      cx = S.W * SUN.x; cy = S.H * SUN.y;
      R = SUN.r * Math.min(S.H, S.W * 1.3);                   // smaller on tall phones, so text stays clear
      band = R * (RAYS / SUN.r);
      clearRows = S.rows * TREELINE; clearW = S.W; cwG = S.cw;
      [farTop, rangeTop, spurTop, hazeTop, treeData].forEach((f) => f.clear());
    },

    layers: [
      {
        name: 'sky dust', z: 0, fixed: true, occlude: false, fps: 6, stop: false, cssDim: true,
        span(k, S, t, out) { out[0] = 0; out[1] = S.rows * TREELINE; return true; },
        glyph(k, r, d, t, put) {
          const h = hash(k, r, 11);
          if (h < 0.996) return;
          put('·', 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * (0.6 + h) + h * 900)));
        },
      },
      {
        name: 'sun rays', z: 0.005, fixed: true, occlude: false, static: true, stop: false, cssDim: true,
        span(k, S, t, out) { out[0] = (cy - R - band) / S.ch; out[1] = cy / S.ch + 1; return true; },
        glyph(k, r, d, t, put, S) {
          if ((k + r) % 3) return;                                // diagonal hatching
          const x = (k + 0.5) * S.cw, y = (r + 0.5) * S.ch;
          const u = (Math.hypot(x - cx, y - cy) - R) / band;      // 0 at the rim -> 1 outside
          if (u < 0.03 || u > 1) return;
          const side = clamp((x - cx) / R * 0.9 + 0.5, 0.15, 1);  // heavier on the right, clear on the left
          if (noise2(k / Z * 0.11, r / Z * 0.11, 8) * side < u * 0.75) return;
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
          if (hash(k, r, 5) > 0.997) return put('^', 0.8);
          const x = (k + 0.5) * S.cw, y = (r + 0.5) * S.ch;
          const q = Math.hypot(x - cx, y - cy) / R;              // 0 centre -> 1 rim
          const tone = 0.3 + 0.16 * q * q + 0.1 * (noise2(k / Z * 0.06, r / Z * 0.15, 6) - 0.5);
          put(k & 1 ? '/' : '\\', tone);                          // \/\/\/ knit
        },
      },
      {
        name: 'streaks', z: 0.035, occlude: 'cell', static: true, screenSpace: true, stop: false, cssDim: true,
        span(k, S, t, out) { out[0] = S.rows * 0.12; out[1] = S.rows * 0.55; return true; },
        glyph(k, r, d, t, put, S, x) {
          if (x < S.W * 0.42) return;                            // keep clear of the header
          const rs = hash(r, 0, 31);
          if (rs > 0.14) return;                                  // only some rows carry a streak
          const n = noise1(k / Z * 0.045 + rs * 997, 32 + r);
          if (n < 0.72 || hash(k, r, 33) < 0.12) return;
          put(n > 0.8 ? '─' : '-', 0.3 + 0.9 * (n - 0.66));
        },
      },
      {
        // a taller range far behind, mostly snow and haze
        name: 'far range', z: 0.045, occlude: true, static: true, screenSpace: true,
        span(k, S, t, out) {
          const x = k * S.cw - S.layers['far range'].off;
          out[0] = clearTop(farTop(k, S.rows), x); out[1] = S.rows * TREELINE + 1;
          return true;
        },
        glyph(k, r, d, t, put, S, x) {
          const rows = S.rows;
          const top = (kk) => clearTop(farTop(kk, rows), x + (kk - k) * S.cw);
          if (d < 1) return put(edge((top(k + 1) - top(k - 1)) / 2, d), 0.6);
          const s = (top(k + 2) - top(k - 2)) / 4, dd = d / Z, h = hash(k, r, 243);
          if (dd < 5 + 5 * noise1(k / Z * 0.08, 244)) {           // snowfields: hatched in shadow
            if (s > 0.15 && h < 0.45) put(h < 0.3 ? '\\' : ':', 0.35);
            else if (h < 0.06) put(s < 0 ? '/' : '\\', 0.3);
            return;
          }
          if (h < 0.3 * Math.exp(-(dd - 5) / 12)) put(h < 0.08 ? (s < 0 ? '/' : '\\') : h < 0.16 ? ':' : '.', 0.35);
        },
      },
      {
        name: 'mountains', z: 0.08, occlude: true, static: true, screenSpace: true,
        span(k, S, t, out) {
          const x = k * S.cw - S.layers.mountains.off;
          out[0] = clearTop(rangeTop(k, S.rows), x); out[1] = S.rows * TREELINE + 1;
          return true;
        },
        glyph(k, r, d, t, put, S, x) {
          const rows = S.rows;
          const top = (kk) => clearTop(rangeTop(kk, rows), x + (kk - k) * S.cw);
          if (d < 1) return put(edge((top(k + 1) - top(k - 1)) / 2, d), 1);    // ink outline on the ridgeline
          // a nearer spur ridge, outlined where it shows below the main ridge
          let ridge = top, dd = d;
          const sp = (kk) => clearTop(spurTop(kk, rows), x + (kk - k) * S.cw);
          const spk = sp(k);
          if (spk > top(k) + 2.5 * Z) {
            const ds = r - spk;
            if (ds > -0.5 && ds <= 0.5) return put(edge((sp(k + 1) - sp(k - 1)) / 2, ds), 0.85);
            if (ds > 0.5) { ridge = sp; dd = ds; }
          }
          dd /= Z;                                                // design rows below the ridge
          const s = (ridge(k + 2) - ridge(k - 2)) / 4;
          const lit = s < -0.12 ? 2 : s > 0.12 ? 0 : 1;
          const h = hash(k, r, 9);
          const snow = dd < 3.5 + 4 * noise1(k / Z * 0.09, 205) && r < rows * (TREELINE - 0.12);
          if (snow) {
            // snow is the paper: strokes down the fall line, heavier in shadow
            const dens = lit === 2 ? 0.12 : lit === 1 ? 0.28 : 0.6;
            if (h < dens) put(s < -0.25 ? '/' : s > 0.25 ? '\\' : ':', lit === 0 ? 0.7 : 0.5);
            return;
          }
          // rock: dense texture under the snow that thins out with depth
          const f = Math.exp(-(dd - 3) / 7);
          if (h > 0.18 + 0.7 * f) return;
          if (h < 0.08 * f + 0.02 && Math.abs(s) > 0.4) return put(s > 0 ? '\\' : '/', 0.5 + 0.4 * f);
          const n = noise2(k / Z * 0.14, r / Z * 0.28, 10);
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
          if (h < 0.03) put(h < 0.01 ? '-' : '·', 0.3);
        },
      },
      {
        name: 'treeline', z: TREE_Z, occlude: true, static: true,
        span(k, S, t, out) { out[0] = S.rows * TREELINE - treeData(k)[0]; out[1] = S.rows * TREELINE + 1; return true; },
        glyph(k, r, d, t, put, S) {
          const [, dx, th] = treeData(k);
          const h = hash(k, r, 312);
          if (dx === 99) return h < 0.5 && put(h < 0.2 ? ',' : "'", 0.6);
          const fromTop = (r - (S.rows * TREELINE - th)) / Z;     // design rows below this tree's tip
          if (d < 1) {
            if (Math.abs(dx) < 0.9) return put(fromTop < 1.2 ? '|' : '^', 0.95);
            const s = (treeData(k + 1)[0] - treeData(k - 1)[0]) / 2;
            return put(Math.abs(s) < 0.6 ? '_' : dx < 0 ? '/' : '\\', 0.95);   // ledges at the tier tips
          }
          if (Math.abs(dx) < 0.5) return fromTop > 1 && put(h < 0.85 ? '|' : ':', 0.9);   // trunk
          if (h > 0.9) return;
          put(dx < 0 ? '/' : '\\', dx < 0 ? 0.62 : 0.92);          // sunlit left side is lighter
        },
      },
      {
        name: 'cabin', z: CABIN.z, occlude: true, static: true,
        span(k, S, t, out) {
          const l = cabinLeft(k);
          if (l === null) return false;
          out[0] = S.rows * TREELINE - cabinHeight((k - l + 0.5) / Z) * Z; out[1] = S.rows * TREELINE + 1;
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const l = cabinLeft(k), u = k - l, U = (u + 0.5) / Z;
          const ground = Math.round(S.rows * TREELINE);
          const up = ground - r, Up = (up - 0.5) / Z;             // rows above the ground
          const W = CABIN.w, wc = Math.round(W * Z);              // wall width in columns
          // woodpile: stacked log ends
          if (U >= W + 2.5) return put(hash(k, r, 414) < 0.8 ? 'o' : '.', 0.85);
          // chimney: stone, with a cap
          if (isChimney(U) && Up >= roofAt(U) - 0.3) return put(d < 1 ? '=' : (k + r) % 2 ? '#' : '=', 0.95);
          // roof
          if (Up >= CABIN.wall) {
            const left = U < W / 2;
            if (d < 1) return put(Math.abs(U - W / 2) < 0.8 / Z + 0.3 ? '^' : left ? '/' : '\\', 1);
            if (up === Math.round(CABIN.wall * Z) + 1) return put('=', 0.9);          // eave board
            return (left ? (k + r) % 2 === 0 : (k - r) % 2 === 0) && put(left ? '/' : '\\', 0.7);   // shingles
          }
          // log walls with notched corners: log ends stick out past the walls
          if (u < 0 || u >= wc) return r % 2 === 0 && put('o', 0.9);
          if (u === 0 || u === wc - 1) return put('|', 0.95);
          // door, centred
          const dc0 = Math.round(wc / 2 - 2.6 * Z), dc1 = Math.round(wc / 2 + 2.6 * Z);
          const dTop = Math.round(5.6 * Z);
          if (u >= dc0 && u <= dc1 && up <= dTop) {
            if (up === dTop) return put('_', 0.95);
            if (u === dc0 || u === dc1) return put('|', 0.95);
            if (u === dc1 - 2 && up === Math.round(dTop / 2)) return put('o', 0.95);   // handle
            return (u - dc0) % 2 === 0 && put(':', 0.35);           // planks
          }
          // two windows with a cross of panes and a sill
          for (const wx of [Math.round(3 * Z), wc - Math.round(3 * Z) - Math.round(6.5 * Z)]) {
            const w0 = wx, w1 = wx + Math.round(6.5 * Z), b = Math.round(2.2 * Z), tp = Math.round(5.6 * Z);
            if (u < w0 || u > w1 || up < b || up > tp) continue;
            if (up === tp) return put('_', 0.95);
            if (up === b) return put('=', 0.95);                    // sill
            if (u === w0 || u === w1) return put('|', 0.95);
            const mc = Math.round((w0 + w1) / 2), mr = Math.round((b + tp) / 2);
            if (u === mc && up === mr) return put('+', 0.95);
            if (u === mc) return put('|', 0.8);
            if (up === mr) return put('-', 0.8);
            return;                                                // glass: bare paper
          }
          if (up === 0) return put('_', 0.9);
          put(r % 2 ? '=' : '─', r % 2 ? 0.85 : 0.6);               // logs
        },
      },
      {
        name: 'smoke', z: CABIN.z, occlude: false, stop: false, merge: true,
        custom(S, t, putAt) {
          const L = S.layers.cabin;
          const [c0, clen] = ROUTE_AT.cabin;
          const n0 = Math.floor((L.off / CABIN.z) / ROUTE_LEN) - 1;
          for (let n = n0; n <= n0 + 2; n++) {
            const left = Math.round((n * ROUTE_LEN + c0 + clen * CABIN.at) * CABIN.z / S.cw - CABIN.w * Z / 2);
            const sx = (left + (CABIN.w * CABIN.chim + 1.2) * Z) * S.cw - L.off;
            if (sx < -300 || sx > S.W + 300) continue;
            const top = S.rows * TREELINE - (CABIN.wall + CABIN.roof * 0.6 + 4) * Z;
            const N = Math.round(14 * Z);
            for (let i = 0; i < N; i++) {                         // puffs drifting up and off with the wind
              const f = i / N;
              const row = top - 1 - i;
              const x = sx + f * 14 * Z * S.cw + Math.sin(t * 1.3 + i * 0.6) * S.cw * (0.4 + f * 3);
              const m = 1 + Math.round(f * 4 * Z);
              for (let j = 0; j < m; j++) {
                if (hash(n * 31 + i, j, (t * 4) | 0) < 0.3 + f * 0.3) continue;
                putAt(x + (j - m / 2) * S.cw, row, '•=─·'[(i + j + ((t * 3) | 0)) % 4], (1 - f) * 0.75);
              }
            }
          }
        },
      },
      // The ground: every row moves at its own speed, densest at the top.
      ...[[TREELINE, 0.74], [0.74, 0.82], [0.82, 0.91], [0.91, 1]].map((b, i) => ({
        name: 'forest ' + (i + 1), band: b, zAt: forestZ, occlude: true, stop: i === 0 || i === 3,
        glyph(k, r, rf, t, put, S, x) {
          const z = forestZ(rf), X = k * S.cw / z;
          const gnd = groundAt(X, z);
          if (gnd === 0) return forestStroke(k, r, (rf - TREELINE) / (1 - TREELINE), t, put, 51 + i);
          if (gnd === 1) return meadowStroke(k, r, (rf - TREELINE) / (1 - TREELINE), t, put);
          if (gnd === 2) return shoreStroke(k, r, put);
          if (gnd === 3) return lakeStroke(X, z, k, r, t, put, S, x);
          riverStroke(X, z, r, t, put);
        },
      })),
      {
        // someone fishing off the end of a dock on the far side of the lake
        name: 'fisher', z: LAKE.zm, occlude: 'cell',
        custom(S, t, putAt) {
          const L = S.layers.fisher, z = LAKE.zm;
          const [l0, llen] = ROUTE_AT.lake;
          const n0 = Math.floor((L.off / z) / ROUTE_LEN) - 1;
          const row = Math.round(rowOfZ(z, S.rows));
          const bob = Math.sin(t * 2.2) > 0.2;
          for (let n = n0; n <= n0 + 2; n++) {
            const X = n * ROUTE_LEN + l0 + llen / 2 + lakeHalf(z) - 110;   // where the dock reaches out to
            const x = X * z - L.off - 13 * S.cw;
            if (x < -400 || x > S.W + 100) continue;
            drawArt(putAt, FISHER, x, row, S.cw, 0.95, (ch, i) => (ch === '*' ? (bob ? '•' : 'o') : ch));
            if (Math.sin(t * 2.2 + 1) > 0.5) {                     // rings spreading from the bobber
              putAt(x - 0.5 * S.cw, row - 1, '(', 0.5); putAt(x + 1.5 * S.cw, row - 1, ')', 0.5);
            }
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
          const wave = Math.sin(t * 2.5) > 0 ? 0 : 1;
          for (let n = n0; n <= n0 + 2; n++) {
            const X = riverX(n * ROUTE_LEN + r0, rlen, z) + Math.sin(t * 0.6) * 25;
            const x = X * z - offZ;
            if (x < -100 || x > S.W + 100) continue;
            const row = Math.round(rowOfZ(z, S.rows));
            drawArt(putAt, TUBER.map((l) => l[wave]), x - 5.5 * S.cw, row, S.cw, 0.95);
            for (let j = -7; j <= 7; j += 2) putAt(x + j * S.cw, row + 1, Math.sin(t * 3 + j) > 0 ? '~' : '-', 0.5);   // wake
          }
        },
      },
      {
        name: 'birds', z: 0.2, occlude: false, stop: false,
        custom(S, t, putAt) {
          for (let i = 0; i < 5; i++) {
            const speed = 16 + 8 * hash(i, 0, 601);
            const lane = S.W + 240;
            const x = S.W + 120 - ((hash(i, 1, 601) * 0.3 * lane + t * speed) % lane);
            const row = S.rows * (0.42 + 0.06 * hash(i, 2, 601)) + Math.sin(t * 0.5 + i * 2.1) * 1.4;
            const up = Math.sin(t * (5 + i) + i * 3) > -0.3;
            putAt(x - S.cw, row, up ? '\\' : '-', 0.85);
            putAt(x, row, 'v', 0.85);
            putAt(x + S.cw, row, up ? '/' : '-', 0.85);
          }
        },
      },
    ],
  };
})(window);
