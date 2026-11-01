/*
 * Scene: Rockies
 * Daytime in the Canadian Rockies, drawn like a pen-and-ink print: warm paper
 * sky, an amber sun, a jagged range where the snow is the paper itself and the
 * rock is hatched in charcoal, olive foothills and spruce, a jade lake that
 * mirrors the peaks, a few birds, and a rock pile right in front of the lens.
 *
 * Colour lives in the characters; silhouettes get only a faint tint, so when
 * a layer falls out of focus its strokes blur into soft haze (depth of field).
 *
 * Depth (z), back to front:
 *   0     sky, sun                 0.02 clouds
 *   0.04  the range                0.09 foothills
 *   0.18  far spruce               0.28 near spruce    0.35 birds
 *   0.06 → 1.0  lake (every row has its own depth, so it slides like a floor)
 *   0.95  rock pile
 *
 * Light comes from the upper left: faces that rise to the right are lit,
 * faces that fall away to the right are in shadow and get denser hatching.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;
  const { hash, noise1, noise2, fbm1, ridged1, clamp } = NS.noise;
  const edge = NS.edge;

  const HORIZON = 0.62;                                    // waterline, fraction of height
  const SUN = { x: 0.22, y: 0.1, r: 0.045 };               // fractions of W / H / min(H, W)
  const waterZ = (rf) => 0.06 + 0.94 * Math.pow(clamp((rf - HORIZON) / (1 - HORIZON), 0, 1), 1.5);

  // ---- palette -----------------------------------------------------------------------
  const INKS = {
    sky: '#b9ab94', sun: '#efad45', sunRay: '#d99a3e',
    cloud: '#8c8170', cloudShade: '#b9ad99',
    snowShade: '#a1978a',
    rock: '#2f2924', rockMid: '#7a6e61',
    forest: '#5f6b42', forestDark: '#3b4527',
    spruce: '#1f2a16', spruceLight: '#6b7f45',
    lake: '#7f9e89',
    reflSnow: '#fffdf8', reflRock: '#7a6f62', reflForest: '#626f45', reflSpruce: '#33442a', reflSky: '#c8d5c3',
    stone: '#4b433a', stoneMid: '#8a7e70',
    bird: '#3a332c',
  };
  const lerpHex = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) + ((((pb >> sh) & 255) - ((pa >> sh) & 255)) * t));
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  };

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

  // 2 = lit (rises to the right), 1 = side-lit, 0 = shadow
  function facing(top, k, rows) {
    const s = (top(k + 2, rows) - top(k - 2, rows)) / 4;
    return s < -0.12 ? 2 : s > 0.12 ? 0 : 1;
  }

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

  // /|\ branch strokes: light on the sunny side, dark on the shaded side
  function spruceGlyph(k, r, d, put, a, seed) {
    const h = hash(k, r, seed);
    if (firDx === 99) return h < 0.45 && put(h < 0.2 ? ',' : '.', a * 0.8, h < 0.2 ? 'spruce' : 'spruceLight');
    put('█', a * 0.14, 'spruce');                            // a light tone under the strokes
    if (d < 1 && Math.abs(firDx) < 1) return put('^', a, 'spruce');
    if (h > 0.94) return;
    if (firDx < -0.55) put('/', a * (r % 3 === 0 ? 1 : 0.85), 'spruceLight');
    else if (firDx > 0.55) put('\\', a, 'spruce');
    else put('|', a, 'spruce');
  }

  // ---- the range: snow, glaciers, strata, scree --------------------------------------
  // Which surface is at (k, r)? Returns 'snow' | 'snowShade' | 'ice' | 'rock'.
  function rangeSurface(k, r, d, rows, lit) {
    const snowline = rows * (0.36 + 0.06 * noise1(k * 0.03, 205));
    const glacier = noise1(k * 0.055, 206) > 0.6 && r < rows * (HORIZON - 0.07);   // ice down a gully
    if (d < 2.5 || (r < snowline && d < 6 + 8 * noise1(k * 0.11, 207))) return lit === 0 ? 'snowShade' : 'snow';
    if (glacier && d < 18) return lit === 0 ? 'snowShade' : 'ice';
    return 'rock';
  }
  const rangeFill = ['#e6e0d6', '#f2eee7', '#fbf9f4'];       // shadow, side, lit: snow is whiter than the sky

  // ---- sky, sun, clouds ----------------------------------------------------------------
  function cloud(seed, base, freq) {
    const top = memo((k) => {
      const p = noise1(k * freq, seed);
      if (p < 0.64) return 9;                                   // no cloud here
      const a = Math.sqrt((p - 0.64) / 0.36);                    // rounded ends
      const bumps = noise1(k * 0.13, seed + 1) * 0.7 + noise1(k * 0.33, seed + 2) * 0.3;
      return base - a * (0.025 + 0.075 * bumps);               // cauliflower top
    });
    const bottom = (k) => base + 0.008 * Math.max(0, (noise1(k * freq, seed) - 0.64) / 0.36);
    return { top, bottom };
  }
  const CLOUD = cloud(221, 0.25, 0.034);

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
  // What colour sits at screen (x, row) above the waterline? Sets reflA (opacity).
  let reflA = 0;
  function sceneInk(x, r, S) {
    const L = S.layers, rows = S.rows;
    const col = (name) => Math.floor((x + L[name].off) / S.cw);
    reflA = 0.8;
    if (r >= nearSpruceTop(col('near spruce'), rows)) return 'reflSpruce';
    if (r >= farSpruceTop(col('far spruce'), rows)) return 'reflSpruce';
    let k = col('foothills');
    if (r >= footTop(k, rows)) return 'reflForest';
    k = col('range');
    const top = rangeTop(k, rows);
    if (r >= top) {
      const s = rangeSurface(k, r, r - top, rows, facing(rangeTop, k, rows));
      reflA = s === 'rock' ? 0.75 : 1;
      return s === 'rock' ? 'reflRock' : 'reflSnow';
    }
    k = col('clouds');
    if (r >= CLOUD.top(k, rows) && r <= CLOUD.bottom(k) * rows) { reflA = 1; return 'reflSnow'; }
    const xs = x + L.sun.off, y = (r + 0.5) * S.ch;
    if ((xs - sx) ** 2 + (y - sy) ** 2 < sr * sr * 1.6) { reflA = 1; return 'sun'; }
    reflA = 0.6;
    return 'reflSky';
  }

  NS.scenes.rockies = {
    title: 'Rockies',
    focus: 0.26,                                            // the shoreline spruce
    // the sky itself is a CSS background behind every canvas: warm paper + sun glow
    background:
      'radial-gradient(circle at 22% 10%, rgba(244,176,70,0.32) 0, rgba(244,176,70,0.14) 8vmin, rgba(244,176,70,0) 30vmin),' +
      'linear-gradient(180deg, #e2d6c1 0%, #e9dfcd 45%, #eee6d7 62%, #eee6d7 100%)',
    inks: INKS,
    glyphs: "─-·█.,:'^_=|/\\v",

    setup(S) {
      sx = S.W * SUN.x; sy = S.H * SUN.y; sr = Math.max(SUN.r * Math.min(S.H, S.W * 1.4), S.cw * 3.5);
      [rangeTop, footTop, CLOUD.top].forEach((f) => f.clear());
      firMemo.clear(); rockMemo.clear();
    },

    layers: [
      {
        name: 'sky', z: 0, fixed: true, occlude: false, static: true, ink: 'sky',
        span(k, S, t, out) { out[0] = 0; out[1] = S.rows * HORIZON; return true; },
        glyph(k, r, d, t, put, S) {
          if (r % 2 || noise2(k * 0.03, r * 0.2, 4) < 0.42) return;   // thin high streaks
          put('─', 0.22 + 0.3 * (1 - r / (S.rows * HORIZON)));
        },
      },
      {
        name: 'sun', z: 0.005, fixed: true, occlude: true, fill: '#f2b552', static: true, merge: true, stop: false,
        span(k, S, t, out) {
          const dx = (k + 0.5) * S.cw - sx;
          if (Math.abs(dx) >= sr) return false;
          const h = Math.sqrt(sr * sr - dx * dx);
          out[0] = (sy - h) / S.ch; out[1] = (sy + h) / S.ch;
          return true;
        },
        glyph() {},
      },
      {
        name: 'sun rays', z: 0.005, fixed: true, occlude: false, static: true, merge: true, stop: false, ink: 'sunRay',
        span(k, S, t, out) { out[0] = (sy - sr * 2.8) / S.ch; out[1] = (sy + sr * 2.8) / S.ch; return true; },
        glyph(k, r, d, t, put, S) {
          if ((k + r) % 3) return;                                // diagonal hatching
          const u = (Math.hypot((k + 0.5) * S.cw - sx, (r + 0.5) * S.ch - sy) - sr * 1.35) / (sr * 1.45);
          if (u < 0 || u > 1 || hash(k, r, 9) < u * 0.8) return;
          put('/', 0.75 * (1 - u));
        },
      },
      {
        name: 'clouds', z: 0.02, occlude: true, fill: '#faf7f1', static: true, stop: false,
        span(k, S, t, out) {
          const top = CLOUD.top(k, S.rows);
          if (top > S.rows) return false;
          out[0] = top; out[1] = CLOUD.bottom(k) * S.rows + 0.6;
          return out[1] - out[0] > 0.7;
        },
        glyph(k, r, d, t, put, S) {
          if (d < 1) return put(edge((CLOUD.top(k + 1, S.rows) - CLOUD.top(k - 1, S.rows)) / 2, d), 0.9, 'cloud');
          const below = CLOUD.bottom(k) * S.rows + 0.6 - r;          // rows above the cloud base
          if (below < 1) return put('_', 0.8, 'cloudShade');
          const h = hash(k, r, 222);
          if (h < (below < 3 ? 0.7 : 0.35)) put(below < 3 ? ':' : '·', below < 3 ? 0.75 : 0.5, 'cloudShade');  // grey bellies
        },
      },
      {
        name: 'range', z: 0.04, occlude: true, static: true, ink: 'rock',
        fill: (k, S) => rangeFill[facing(rangeTop, k, S.rows)],
        span(k, S, t, out) { out[0] = rangeTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) {
          const rows = S.rows;
          const lit = facing(rangeTop, k, rows);
          const surf = rangeSurface(k, r, d, rows, lit);
          const h = hash(k, r, 208);
          // an ink outline on every summit
          if (d < 1) return put(edge((rangeTop(k + 1, rows) - rangeTop(k - 1, rows)) / 2, d), 0.95, 'rock');
          if (surf !== 'rock') {
            // snow is the paper: sparse hatching down the fall line, heavier in shadow
            const s = (rangeTop(k + 2, rows) - rangeTop(k - 2, rows)) / 4;
            const dens = lit === 2 ? 0.14 : lit === 1 ? 0.3 : 0.55;
            if (h < dens) put(s < -0.25 ? '/' : s > 0.25 ? '\\' : h < dens / 2 ? ':' : '|', lit === 0 ? 0.8 : 0.65, 'snowShade');
            return;
          }
          put('█', lit === 0 ? 0.2 : lit === 1 ? 0.13 : 0.08, 'rockMid');   // rock gets a tone
          if (r > rows * (HORIZON - 0.045)) return h < 0.6 && put(h < 0.3 ? ':' : '.', 0.75, 'rock');   // scree
          // tilted sedimentary strata, the signature of the Rockies
          const band = (((r + Math.floor(k * 0.35)) % 3) + 3) % 3 === 0;
          if (band && h < 0.85) return put(h < 0.45 ? '_' : '=', 0.85, 'rock');
          if (h < (lit === 0 ? 0.7 : 0.5)) put(h < 0.15 ? (lit === 2 ? '/' : '\\') : h < 0.4 ? ':' : '.', 0.75, 'rock');
        },
      },
      {
        name: 'foothills', z: 0.09, occlude: true, static: true,
        fill: (k, S) => (facing(footTop, k, S.rows) === 0 ? '#d6d4b8' : '#e2e0c7'),
        span(k, S, t, out) { out[0] = footTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) {
          const lit = facing(footTop, k, S.rows) > 0;
          if (d < 1) return put(edge((footTop(k + 1, S.rows) - footTop(k - 1, S.rows)) / 2, d), 0.9, 'forestDark');
          if (d < 1.6 && footTop(k, S.rows) < S.rows * (HORIZON - 0.13)) return;   // a dusting of snow: bare paper
          put('█', lit ? 0.1 : 0.17, 'forest');
          const h = hash(k, r, 212);
          if (h < 0.7) put(h < 0.3 ? ':' : h < 0.5 ? '^' : '.', 0.9, lit && h > 0.3 ? 'forest' : 'forestDark');
        },
      },
      {
        name: 'far spruce', z: 0.18, occlude: true, fill: '#d3d6b8', static: true,
        span(k, S, t, out) { out[0] = farSpruceTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) { farSpruceTop(k, S.rows); spruceGlyph(k, r, d, put, 0.7, 63); },
      },
      {
        name: 'near spruce', z: 0.28, occlude: true, fill: '#bfc99e', static: true,
        span(k, S, t, out) { out[0] = nearSpruceTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) { nearSpruceTop(k, S.rows); spruceGlyph(k, r, d, put, 0.95, 73); },
      },
      {
        name: 'birds', z: 0.35, occlude: false, stop: false, ink: 'bird',
        custom(S, t, putAt) {
          // a loose flock gliding across, wings flicking between v and -
          for (let i = 0; i < 5; i++) {
            const speed = 20 + 8 * hash(i, 0, 401);
            const lane = S.W + 240;
            const x = S.W + 120 - ((hash(i, 1, 401) * 0.25 * lane + t * speed) % lane);
            const row = S.rows * (0.3 + 0.06 * hash(i, 2, 401)) + Math.sin(t * 0.5 + i * 2.1) * 1.1;
            putAt(x, row, Math.sin(t * (5 + i) + i * 3) > -0.3 ? 'v' : '-', 0.85);
          }
        },
      },
      // The lake: four bands, each row with its own depth and speed.
      ...[[HORIZON, 0.69], [0.69, 0.78], [0.78, 0.89], [0.89, 1]].map((band, i) => ({
        name: 'lake ' + (i + 1), band, zAt: waterZ, occlude: true, stop: i === 0 || i === 3,
        fill: (rf) => lerpHex('#dfe6d6', '#c3d3c1', clamp((rf - HORIZON) / (1 - HORIZON), 0, 1)),   // pale jade
        glyph(k, r, rf, t, put, S, x) {
          const depth = (rf - HORIZON) / (1 - HORIZON);
          const n = noise2(k * 0.06, r * 0.85 + t * 0.16, 81);
          const v = n * (0.8 + 0.2 * Math.sin(t * 1.9 + k * 0.29 + r * 1.7));
          if (v < 0.24 + 0.1 * depth) return;                 // ripples break the mirror into streaks
          // the row this cell mirrors - stretched 1.6x so the peaks land in the lake
          const hr = S.rows * HORIZON, mr = hr - (r + 0.5 - hr) * 1.6;
          const wobble = Math.sin(r * 1.37 + t * 1.1) * S.cw * (0.4 + 2.4 * depth);
          const ink = sceneInk(x + wobble, mr, S);
          const a = reflA * (0.7 + 0.8 * (v - 0.4)) * (1 - 0.15 * depth);
          if (ink === 'sun') return hash(k, r, (t * 6) | 0) > 0.4 && put(v > 0.5 ? '-' : '·', 1, 'sun');   // glitter
          if (ink === 'reflSky') return put(v > 0.6 ? '-' : '·', 0.7, 'lake');   // open water: just ripples
          put(v > 0.55 ? '─' : v > 0.4 ? '-' : '·', a, ink);
        },
      })),
      {
        name: 'rock pile', z: 0.95, occlude: true, static: true,
        fill: (k) => { rocks(k); return rockDx < 0.1 ? '#ebe4d7' : '#ddd4c4'; },
        span(k, S, t, out) {
          const h = rocks(k);
          if (h < 0.8) return false;
          out[0] = S.rows - h + 0.5; out[1] = S.rows + 2;
          return true;
        },
        glyph(k, r, d, t, put) {
          const s = rocks(k - 1) - rocks(k + 1);                 // + means rising to the right
          rocks(k);
          const lit = rockDx < 0.1;
          if (d < 1) return put(edge(s / 2, d), 0.95, 'stone');
          put('█', lit ? 0.1 : 0.2, 'stoneMid');
          const h = hash(k, r, 303);
          if (h > (lit ? 0.45 : 0.65)) return;
          put(h < 0.08 ? '/' : h < 0.35 ? ':' : '.', 0.8, 'stone');
        },
      },
    ],
  };
})(window);
