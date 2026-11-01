/*
 * Scene: Rockies
 * Daytime in the Canadian Rockies. A jagged range with glaciers and tilted
 * rock strata, sun and drifting cumulus, darker foothills, spruce forest, a
 * glacial lake that mirrors the peaks, a few birds, and a rock pile right
 * in front of the lens.
 *
 * Depth (z), back to front:
 *   0     sky, sun                 0.02 clouds
 *   0.04  the range                0.09 foothills
 *   0.18  far spruce               0.28 near spruce    0.35 birds
 *   0.06 → 1.0  lake (every row has its own depth, so it slides like a floor)
 *   0.95  rock pile
 *
 * Light comes from the upper left: faces that rise to the right are lit,
 * faces that fall away to the right are in shadow.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;
  const { hash, noise1, fbm1, ridged1, clamp } = NS.noise;
  const edge = NS.edge;

  const HORIZON = 0.62;                                    // waterline, fraction of height
  const SUN = { x: 0.22, y: 0.1, r: 0.05 };                // fractions of W / H / H
  const waterZ = (rf) => 0.06 + 0.94 * Math.pow(clamp((rf - HORIZON) / (1 - HORIZON), 0, 1), 1.5);

  let sx = 0, sy = 0, sr = 0;                              // sun in css px

  // Cache a per-column shape (as a fraction of height) and return it in rows.
  function memo(fn) {
    const m = new Map();
    const f = (k, rows) => {
      let v = m.get(k);
      if (v === undefined) {
        v = fn(k);
        if (m.size > 40000) m.clear();
        m.set(k, v);
      }
      return v * rows;
    };
    f.clear = () => m.clear();
    return f;
  }

  // ---- landforms (top edge, as a fraction of height) ----------------------------
  const rangeTop = memo((k) => {
    const massif = 0.45 + 0.55 * fbm1(k * 0.004, 201, 2);  // where the big peaks cluster
    const jag = ridged1(k * 0.026, 202, 4);                 // sharp, broken summits
    return HORIZON - (0.08 + 0.44 * Math.pow(jag, 2) * massif) - 0.004 * hash(k, 0, 203);
  });
  const footTop = memo((k) => HORIZON - (0.035 + 0.13 * Math.pow(ridged1(k * 0.021, 211, 3), 1.4)));

  // ---- spruce -----------------------------------------------------------------------
  // Silhouette height (rows above the waterline) at column k. Leaves the offset
  // from the nearest trunk in `firDx` (99 = no tree, just undergrowth).
  let firDx = 0;
  const firMemo = new Map();
  function spruce(k, seed, spacing, hMin, hMax, gaps) {
    const key = k * 131 + seed;
    const m = firMemo.get(key);
    if (m) { firDx = m[1]; return m[0]; }
    let best = 0.6 + 1.1 * noise1(k * 0.07, seed + 5), dx = 99;
    const gapK = gaps ? clamp((noise1(k * 0.011, seed + 9) - 0.26) / 0.2, 0, 1) : 1;
    const cell = Math.floor(k / spacing);
    for (let c = cell - 3; c <= cell + 3; c++) {
      const tx = (c + hash(c, 0, seed)) * spacing;
      const th = (hMin + (hMax - hMin) * Math.pow(hash(c, 1, seed), 1.3)) * gapK;
      if (th < 1.5) continue;
      const a = Math.abs(k + 0.5 - tx);
      // spruce are narrow: a steep cone with a little sawtooth for the branches
      const h = th - a * (2.6 + 0.6 * hash(c, 2, seed)) - ((a * 1.4) % 1) * 0.8;
      if (h > best) { best = h; dx = k + 0.5 - tx; }
    }
    if (firMemo.size > 30000) firMemo.clear();
    firMemo.set(key, [best, dx]);
    firDx = dx;
    return best;
  }
  const farSpruceTop = (k, rows) => rows * HORIZON - spruce(k, 61, 2.8, 2.5, 6.5, false);
  const nearSpruceTop = (k, rows) => rows * HORIZON - spruce(k, 71, 4.2, 6, 19, true);

  function spruceGlyph(k, r, d, put, b, seed) {
    if (firDx === 99) return;
    if (d < 1 && Math.abs(firDx) < 1) return put('^', Math.min(1, b * 1.4));
    if (hash(k, r, seed) > 0.9) return;
    const side = firDx < -0.55 ? -1 : firDx > 0.55 ? 1 : 0;
    put(side < 0 ? '/' : side > 0 ? '\\' : '|', b * (r % 3 === 0 ? 1.15 : 1) * (side < 0 ? 1.15 : side > 0 ? 0.75 : 0.7));
  }

  // ---- the range: snow, glaciers, strata, scree --------------------------------------
  // Sets cellCh (the character, '' for blank) and cellAvg (average brightness of
  // this kind of surface, used for reflections). Returns the cell's brightness.
  let cellCh = '', cellAvg = 0;
  function rangeCell(k, r, d, rows) {
    const s = (rangeTop(k + 2, rows) - rangeTop(k - 2, rows)) / 4;   // face orientation
    const lit = s < -0.12 ? 1 : s > 0.12 ? 0.42 : 0.68;
    const h = hash(k, r, 208);
    if (d < 1) {
      cellCh = edge((rangeTop(k + 1, rows) - rangeTop(k - 1, rows)) / 2, d);
      cellAvg = 0.8 * lit;
      return Math.min(1, 0.55 + 0.45 * lit);
    }
    const snowline = rows * (0.36 + 0.06 * noise1(k * 0.03, 205));
    const glacier = noise1(k * 0.055, 206) > 0.6 && r < rows * (HORIZON - 0.07);   // ice down a gully
    const snow = d < 2.5 || (r < snowline && d < 6 + 8 * noise1(k * 0.11, 207)) || (glacier && d < 18);
    if (snow) {
      cellAvg = 0.82 * lit;
      if (h > 0.5 + 0.5 * lit) { cellCh = ''; return 0; }          // shadowed snow is sparser
      cellCh = s < -0.25 ? '/' : s > 0.25 ? '\\' : h < 0.5 ? ':' : '|';
      return lit * (0.72 + 0.28 * h);
    }
    cellAvg = 0.24 * lit;
    if (r > rows * (HORIZON - 0.045)) {                              // scree + krummholz at the base
      cellCh = (k + r) % 2 === 0 && h < 0.7 ? '·' : '';
      return 0.2 * lit;
    }
    // tilted sedimentary strata, the signature of the Rockies
    const band = (((r + Math.floor(k * 0.35)) % 5) + 5) % 5 === 0;
    if (band && h < 0.55 * lit) { cellCh = h < 0.3 ? '_' : '-'; return 0.36 * lit + 0.04; }
    if (h > 0.12 + 0.3 * lit) { cellCh = ''; return 0; }
    cellCh = lit > 0.9 && h < 0.12 ? '/' : lit > 0.6 ? ':' : '.';
    return 0.26 * lit + 0.05;
  }

  // ---- sky, sun, clouds --------------------------------------------------------------
  function skyB(x, r, S) {
    const v = clamp(r / (S.rows * HORIZON), 0, 1);            // 0 top -> 1 horizon
    const y = (r + 0.5) * S.ch;
    const dist2 = ((x - sx) ** 2 + (y - sy) ** 2) / ((sr * 4) ** 2);
    return 0.07 + 0.32 * Math.pow(v, 1.8) + 0.45 * Math.exp(-dist2);  // haze toward the horizon + sun glow
  }

  function cloud(seed, base, freq) {
    const top = memo((k) => {
      const p = noise1(k * freq, seed);
      if (p < 0.64) return 9;                                   // no cloud here
      const a = Math.sqrt((p - 0.64) / 0.36);                    // rounded ends
      const bumps = noise1(k * 0.13, seed + 1) * 0.7 + noise1(k * 0.33, seed + 2) * 0.3;  // cauliflower top
      return base - a * (0.025 + 0.075 * bumps);
    });
    const bottom = (k) => base + 0.008 * Math.max(0, (noise1(k * freq, seed) - 0.64) / 0.36);
    return { top, bottom };
  }
  const CLOUDS = { high: cloud(221, 0.25, 0.034) };

  function cloudLayer(name, z, c) {
    return {
      name, z, occlude: true, static: true, stop: false,
      span(k, S, t, out) {
        const top = c.top(k, S.rows);
        if (top > S.rows) return false;
        out[0] = top; out[1] = c.bottom(k) * S.rows + 0.6;
        return out[1] - out[0] > 0.7;
      },
      glyph(k, r, d, t, put, S) {
        if (d < 1) return put(edge((c.top(k + 1, S.rows) - c.top(k - 1, S.rows)) / 2, d), 0.78);
        if ((k + r) % 2 === 0) put(d < 2 ? ':' : '·', 0.6 - 0.08 * d);     // sunlit tops, greyer bellies
      },
    };
  }

  // ---- foreground rock pile ------------------------------------------------------------
  let rockDx = 0;
  const rockMemo = new Map();
  function rocks(k) {
    const m = rockMemo.get(k);
    if (m) { rockDx = m[1]; return m[0]; }
    const clump = noise1(k * 0.018, 301);
    let best = 0, bdx = 0;
    if (clump > 0.52) {
      const spacing = 10, cell = Math.floor(k / spacing);
      for (let c = cell - 2; c <= cell + 2; c++) {
        if (hash(c, 0, 302) < 0.2) continue;
        const cx = (c + hash(c, 1, 302)) * spacing;
        const rad = (5 + 9 * hash(c, 2, 302)) * (0.45 + (clump - 0.52) * 1.6);
        const dx = k + 0.5 - cx;
        if (Math.abs(dx) >= rad) continue;
        const h = Math.sqrt(rad * rad - dx * dx) * 0.5 + 0.6 * hash(c, 3, 302);
        if (h > best) { best = h; bdx = dx / rad; }
      }
    }
    if (rockMemo.size > 30000) rockMemo.clear();
    rockMemo.set(k, [best, bdx]);
    rockDx = bdx;
    return best;
  }

  // ---- reflections ---------------------------------------------------------------------
  // What's at screen (x, row) above the waterline?
  function sceneB(x, r, S) {
    const L = S.layers, rows = S.rows;
    const col = (name) => Math.floor((x + L[name].off) / S.cw);
    if (r >= nearSpruceTop(col('near spruce'), rows)) return 0.08;
    if (r >= farSpruceTop(col('far spruce'), rows)) return 0.11;
    let k = col('foothills');
    if (r >= footTop(k, rows)) return 0.17;
    k = col('range');
    const top = rangeTop(k, rows);
    if (r >= top) { rangeCell(k, r, r - top, rows); return cellAvg; }
    k = col('clouds');
    if (r >= CLOUDS.high.top(k, rows) && r <= CLOUDS.high.bottom(k) * rows) return 0.5;
    const xs = x + L.sun.off, y = (r + 0.5) * S.ch;
    if ((xs - sx) ** 2 + (y - sy) ** 2 < sr * sr) return 0.95;
    return skyB(xs, r, S);
  }

  NS.scenes.rockies = {
    title: 'Rockies',
    focus: 0.12,
    glyphs: "─-·█.,:'^_|/\\v",

    setup(S) {
      sx = S.W * SUN.x; sy = S.H * SUN.y; sr = SUN.r * Math.min(S.H, S.W * 0.9);   // smaller on tall phones
      [rangeTop, footTop, CLOUDS.high.top].forEach((f) => f.clear());
      firMemo.clear(); rockMemo.clear();
    },

    layers: [
      {
        name: 'sky', z: 0, fixed: true, occlude: false, static: true,
        span(k, S, t, out) { out[0] = 0; out[1] = S.rows * HORIZON; return true; },
        glyph(k, r, d, t, put, S, x) {
          if (r % 2 || hash(k, r, 2) < 0.04) return;           // scan lines on every other row
          put('─', skyB(x, r, S));
        },
      },
      {
        name: 'sun', z: 0.005, fixed: true, occlude: true, static: true, merge: true, stop: false,
        span(k, S, t, out) {
          const dx = (k + 0.5) * S.cw - sx;
          if (Math.abs(dx) >= sr) return false;
          const h = Math.sqrt(sr * sr - dx * dx);
          out[0] = (sy - h) / S.ch; out[1] = (sy + h) / S.ch;
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const dist = Math.hypot((k + 0.5) * S.cw - sx, (r + 0.5) * S.ch - sy);
          put(dist > sr - S.cw * 0.6 ? '─' : '█', 0.97);      // solid disc, thin-line rim
        },
      },
      cloudLayer('clouds', 0.02, CLOUDS.high),
      {
        name: 'range', z: 0.04, occlude: true, fill: '#1a1a19', static: true,
        span(k, S, t, out) { out[0] = rangeTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) {
          const b = rangeCell(k, r, d, S.rows);
          if (cellCh) put(cellCh, b);
        },
      },
      {
        name: 'foothills', z: 0.09, occlude: true, fill: '#161615', static: true,
        span(k, S, t, out) { out[0] = footTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) {
          const s = (footTop(k + 1, S.rows) - footTop(k - 1, S.rows)) / 2;
          if (d < 1) return put(edge(s, d), s < -0.1 ? 0.5 : 0.3);
          if (d < 2.2 && footTop(k, S.rows) < S.rows * (HORIZON - 0.13)) return put(s < 0 ? '/' : '\\', s < 0 ? 0.6 : 0.32);  // dusting of snow
          if ((k + r) % 2 === 0 && hash(k, r, 212) < 0.6) put(s < 0 ? ':' : '·', s < 0 ? 0.26 : 0.17);     // forested slopes
        },
      },
      {
        name: 'far spruce', z: 0.18, occlude: true, fill: '#141413', static: true,
        span(k, S, t, out) { out[0] = farSpruceTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) { farSpruceTop(k, S.rows); spruceGlyph(k, r, d, put, 0.24, 63); },
      },
      {
        name: 'near spruce', z: 0.28, occlude: true, static: true,
        span(k, S, t, out) { out[0] = nearSpruceTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) { nearSpruceTop(k, S.rows); spruceGlyph(k, r, d, put, 0.44, 73); },
      },
      {
        name: 'birds', z: 0.35, occlude: 'cell', stop: false,
        custom(S, t, putAt) {
          // a loose flock gliding across, wings flicking between v and -
          for (let i = 0; i < 5; i++) {
            const speed = 20 + 8 * hash(i, 0, 401);
            const lane = S.W + 240;
            const x = S.W + 120 - ((hash(i, 1, 401) * 0.25 * lane + t * speed) % lane);
            const row = S.rows * (0.24 + 0.07 * hash(i, 2, 401)) + Math.sin(t * 0.5 + i * 2.1) * 1.1;
            putAt(x, row, Math.sin(t * (5 + i) + i * 3) > -0.3 ? 'v' : '-', 0.68);
          }
        },
      },
      // The lake: four bands, each row with its own depth and speed.
      ...[[HORIZON, 0.69], [0.69, 0.78], [0.78, 0.89], [0.89, 1]].map((band, i) => ({
        name: 'lake ' + (i + 1), band, zAt: waterZ, occlude: true, stop: i === 0 || i === 3,
        glyph(k, r, rf, t, put, S, x) {
          const depth = (rf - HORIZON) / (1 - HORIZON);
          const n = NS.noise.noise2(k * 0.06, r * 0.85 + t * 0.16, 81);
          const v = n * (0.8 + 0.2 * Math.sin(t * 1.9 + k * 0.29 + r * 1.7));
          if (v < 0.27 + 0.14 * depth) return;                 // ripples break the mirror into streaks
          // the row this cell mirrors - stretched 1.6x so the peaks land in the lake
          const hr = S.rows * HORIZON, mr = hr - (r + 0.5 - hr) * 1.6;
          const wobble = Math.sin(r * 1.37 + t * 1.1) * S.cw * (0.4 + 2.4 * depth);
          const refl = Math.max(0.2, sceneB(x + wobble, mr, S));
          const b = refl * (0.85 + 0.9 * (v - 0.45)) * (1 - 0.15 * depth);
          put(b > 0.34 ? '─' : v > 0.6 ? '-' : '·', b);
        },
      })),
      {
        name: 'rock pile', z: 0.95, occlude: true, static: true,
        span(k, S, t, out) {
          const h = rocks(k);
          if (h < 0.8) return false;
          out[0] = S.rows - h + 0.5; out[1] = S.rows + 2;
          return true;
        },
        glyph(k, r, d, t, put) {
          rocks(k);
          const s = rocks(k - 1) - rocks(k + 1);                // rows: + means rising to the right
          rocks(k);
          const lit = rockDx < 0.1;
          if (d < 1) return put(edge(s / 2, d), lit ? 0.85 : 0.45);
          const h = hash(k, r, 303);
          if (h > (lit ? 0.6 : 0.35)) return;
          put(h < 0.06 ? '/' : lit ? ':' : '.', lit ? 0.55 : 0.28);
        },
      },
    ],
  };
})(window);
