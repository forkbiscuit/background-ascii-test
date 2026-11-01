/*
 * Scene: Cascades (Pacific Northwest)
 * A snow-capped volcano, layered forested ridges fading into haze, valley
 * mist, fir-lined shores, a still lake that mirrors all of it, a canoe, and
 * cedar boughs hanging right in front of the lens.
 *
 * Depth (z), back to front:
 *   0     sky + stars, 0.02 volcano (both fixed - far enough away to never move)
 *   0.07  far ridge          0.13 mid ridge + valley mist
 *   0.2   far firs           0.3  near firs + shore mist
 *   0.06 → 1.0  lake (every row has its own depth, so it slides like a floor)
 *   0.9   boughs
 *
 * Atmospheric perspective: farther ridges get a slightly lighter fill and
 * dimmer texture; nearer ones sit closer to the background colour.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;
  const { hash, noise1, noise2, fbm1, ridged1, clamp } = NS.noise;
  const edge = NS.edge;

  const HORIZON = 0.6;                                     // waterline, fraction of height
  const VOLCANO = { x: 0.63, peak: 0.13, halfBase: 1.05 };  // x/peak: fractions of W/H; halfBase: × height
  const waterZ = (rf) => 0.06 + 0.94 * Math.pow(clamp((rf - HORIZON) / (1 - HORIZON), 0, 1), 1.5);

  let vx = 0, vy = 0, vh = 0, vw = 0;                       // volcano geometry in css px

  // ---- volcano ----------------------------------------------------------------
  // Concave profile like a real stratovolcano: steep, rounded summit, long
  // gentle flanks, plus a shoulder on the left.
  const vyMemo = new Map();
  function volcanoY(x) {
    const key = Math.round(x * 4);
    const m = vyMemo.get(key);
    if (m !== undefined) return m;
    const y = volcanoYRaw(x);
    if (vyMemo.size > 50000) vyMemo.clear();
    vyMemo.set(key, y);
    return y;
  }
  function volcanoYRaw(x) {
    const s = Math.abs(x - vx) / vw;
    if (s >= 1) return Infinity;
    const sm = Math.sqrt(s * s + 0.0012) - 0.0346;
    const e = Math.pow(Math.max(0, 1 - sm), 2.1);
    const shoulder = 0.07 * Math.exp(-Math.pow((x - vx) / vw + 0.27, 2) / 0.003);
    const rough = 0.018 * (fbm1((x - vx) * 0.03, 17, 3) - 0.5);
    return vy + vh * (1 - e - shoulder + rough);
  }

  // Snow / rock / forest shading at a point. Returns -1 for sky.
  let vSnow = false;
  function volcanoShade(x, y) {
    if (y < volcanoY(x)) return -1;
    const dx = x - vx;
    const u = (y - vy) / vh;                                 // 0 summit -> 1 waterline
    const ang = Math.atan2(dx, y - vy + vh * 0.08);          // radial angle from the summit
    const gully = noise1(ang * 26 + 5, 14) * 0.7 + noise1(ang * 70, 15) * 0.3;
    const snowline = 0.36 + 0.1 * noise1(ang * 6, 12) + 0.22 * (gully - 0.5);
    const lit = dx < 0 ? 1 : 0.62 + 0.12 * Math.exp(-dx / vw * 8); // low sun from the left
    vSnow = u < snowline;
    if (vSnow) return lit * (0.5 + 0.45 * gully) * (1 - 0.3 * u / snowline);
    return 0.12 + 0.05 * lit;
  }

  // ---- conifers ---------------------------------------------------------------
  // Silhouette height (rows above the base) at column k. Leaves the offset from
  // the nearest trunk in `firDx` (99 = no tree, just undergrowth).
  let firDx = 0;
  const firMemo = new Map();
  function firs(k, seed, spacing, hMin, hMax, gaps) {
    const key = k * 131 + seed;
    const m = firMemo.get(key);
    if (m) { firDx = m[1]; return m[0]; }
    let best = 0.6 + 1.1 * noise1(k * 0.07, seed + 5), dx = 99;   // undergrowth
    let gapK = 1;
    if (gaps) gapK = clamp((noise1(k * 0.011, seed + 9) - 0.28) / 0.2, 0, 1);  // clearings
    const cell = Math.floor(k / spacing);
    for (let c = cell - 3; c <= cell + 3; c++) {
      const tx = (c + hash(c, 0, seed)) * spacing;
      const th = (hMin + (hMax - hMin) * Math.pow(hash(c, 1, seed), 1.3)) * gapK;
      if (th < 1.5) continue;
      const dist = k + 0.5 - tx;
      const a = Math.abs(dist);
      // narrow fir with tiered branches (the sawtooth on the edge)
      const h = th - a * (2.3 + 0.6 * hash(c, 2, seed)) - ((a * 1.4) % 1) * 0.8;
      if (h > best) { best = h; dx = dist; }
    }
    if (firMemo.size > 30000) firMemo.clear();
    firMemo.set(key, [best, dx]);
    firDx = dx;
    return best;
  }

  // Fir texture: /|\ branch strokes, rim-lit from the left.
  function firGlyph(k, r, d, put, b, seed) {
    if (firDx === 99) {                                      // undergrowth
      const h = hash(k, r, seed);
      if (h < 0.3) put(h < 0.1 ? ',' : '.', b * 0.7);
      return;
    }
    if (d < 1 && Math.abs(firDx) < 1) return put('^', Math.min(1, b * 1.4));
    if (hash(k, r, seed) > 0.88) return;
    const side = firDx < -0.55 ? -1 : firDx > 0.55 ? 1 : 0;
    const tier = r % 3 === 0 ? 1.15 : 1;
    put(side < 0 ? '/' : side > 0 ? '\\' : '|', b * tier * (side < 0 ? 1.15 : side > 0 ? 0.8 : 0.7));
  }

  // ---- terrain (top row at world column k) ---------------------------------------
  const farRidgeTop = (k, rows) => rows * (HORIZON - 0.06 - 0.24 * (0.55 * fbm1(k * 0.008, 31, 4) + 0.45 * ridged1(k * 0.011, 33, 3)) + 0.04);
  const midRidgeBase = (k, rows) => rows * (HORIZON - 0.03 - 0.09 * Math.pow(fbm1(k * 0.009, 41, 3), 1.3));
  const midRidgeTop = (k, rows) => midRidgeBase(k, rows) - firs(k, 45, 2.2, 0, 2.6, false);
  const farFirTop = (k, rows) => rows * HORIZON - firs(k, 61, 3, 3, 7.5, false);
  const nearFirTop = (k, rows) => rows * HORIZON - firs(k, 71, 4.4, 7, 22, true);

  function skyB(x, r, S) {
    const v = clamp(r / (S.rows * HORIZON), 0, 1);            // 0 top -> 1 waterline
    const u = x / S.W - 0.25;                                  // afterglow off to the left
    return 0.05 + 0.28 * Math.pow(v, 2.6) + 0.32 * Math.exp(-(u * u) / 0.05 - Math.pow(1 - v, 2) / 0.08);
  }

  // What's at screen (x, row) above the waterline? Used for reflections.
  function sceneB(x, r, S) {
    const L = S.layers, rows = S.rows;
    const col = (name) => Math.floor((x + L[name].off) / S.cw);
    if (r >= nearFirTop(col('near firs'), rows)) return 0.06;
    if (r >= farFirTop(col('far firs'), rows)) return 0.09;
    if (r >= midRidgeTop(col('mid ridge'), rows)) return 0.12;
    if (r >= farRidgeTop(col('far ridge'), rows)) return 0.17;
    const v = volcanoShade(x + L.volcano.off, (r + 0.5) * S.ch);
    if (v >= 0) return vSnow ? v * 0.9 : v;
    return skyB(x, r, S);
  }

  NS.scenes.pnw = {
    title: 'Cascades',
    focus: 0.2,
    glyphs: "─-·.,:'^_|/\\*v",

    setup(S) {
      vx = S.W * VOLCANO.x; vy = S.H * VOLCANO.peak;
      vh = S.H * HORIZON - vy; vw = S.H * VOLCANO.halfBase;
      firMemo.clear(); vyMemo.clear();
    },

    sprite: {
      name: 'canoe',
      z: 0.39, x: 0.4, y: 0.805, bob: 0.7, bobSpeed: 1.2,
      // An original cedar-red canoe with a lantern on a pole. '.' = transparent.
      art: [
        '..............yy..............',
        '.............yYYy.............',
        '.............yYYy.............',
        '..............kk..............',
        '..............k...............',
        '..............k...............',
        '..............k...............',
        '..............k...............',
        '.r..........................r.',
        '.rr........................rr.',
        '..rrrrrrrrrrrrrrrrrrrrrrrrrr..',
        '...hHHHHHHHHHHHHHHHHHHHHHHh...',
        '.....hhhhhhhhhhhhhhhhhhhh.....',
      ],
      palette: { y: '#b9893a', Y: '#f6c453', k: '#4a3527', r: '#6a2c1d', H: '#b0503a', h: '#7a3422' },
      under(ctx, s) {
        // the lantern, broken up in the water below
        ctx.fillStyle = '#f6c453';
        for (let i = 0; i < 7; i++) {
          if (Math.sin(s.t * 2.7 + i * 1.9) < -0.25) continue;
          const y = s.y + s.h + s.CH * (0.3 + i * 0.85);
          const x = s.x + 14.5 * s.px + Math.sin(s.t * 1.8 + i * 1.3) * s.px * (1 + i * 0.7);
          ctx.globalAlpha = 0.5 - i * 0.06;
          ctx.fillRect(Math.round(x), Math.round(y), s.px * (i % 3 ? 1 : 2), Math.max(1, Math.round(s.px / 2)));
        }
        ctx.globalAlpha = 1;
      },
      over(ctx, s) {
        const gx = s.x + 15 * s.px, gy = s.y + 1.5 * s.px, gr = s.px * 15;
        const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        grd.addColorStop(0, 'rgba(246,196,83,0.2)');
        grd.addColorStop(1, 'rgba(246,196,83,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grd;
        ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        ctx.globalCompositeOperation = 'source-over';
      },
    },

    layers: [
      {
        name: 'sky', z: 0, fixed: true, occlude: false, fps: 8,
        span(k, S, t, out) { out[0] = 0; out[1] = S.rows * HORIZON; return true; },
        glyph(k, r, d, t, put, S, x) {
          const v = r / (S.rows * HORIZON);
          const h = hash(k, r, 2);
          if (v < 0.5 && h > 0.992) {                           // stars, only up high
            return put(h > 0.9985 ? '*' : '·', (0.2 + 0.45 * (0.5 + 0.5 * Math.sin(t * (0.7 + h * 2) + h * 999))) * (1 - v));
          }
          if (r % 2) return;                                    // scan lines on every other row
          const cloud = noise2(k * 0.02, r * 0.12, 4);
          if (cloud < 0.3 || hash(k, r, 5) < 0.04) return;
          put('─', skyB(x, r, S) * (0.55 + 0.6 * cloud));
        },
      },
      {
        name: 'volcano', z: 0.02, fixed: true, occlude: true, fill: '#181817', static: true,
        span(k, S, t, out) {
          const y = volcanoY((k + 0.5) * S.cw);
          if (!isFinite(y)) return false;
          out[0] = y / S.ch; out[1] = S.rows * HORIZON + 1;
          return true;
        },
        glyph(k, r, d, t, put, S) {
          const x = (k + 0.5) * S.cw, y = (r + 0.5) * S.ch;
          const b = volcanoShade(x, Math.max(y, volcanoY(x) + 0.5));
          if (d < 1) {
            const slope = (volcanoY(x + S.cw) - volcanoY(x - S.cw)) / (2 * S.ch);
            return put(edge(slope, d), vSnow ? Math.min(1, b + 0.25) : 0.3);
          }
          const h = hash(k, r, 15);
          const dx = x - vx;
          if (vSnow) {
            if (h > 0.42 + b) return;                           // gullies stay sparse and dark
            const ang = Math.atan2(dx, y - vy + vh * 0.08);
            // strokes follow the fall line: / down the left flank, \ down the right
            const ch = b > 0.36 ? (Math.abs(ang) < 0.12 ? '|' : ang < 0 ? '/' : '\\') : b > 0.27 ? ':' : '.';
            return put(ch, b * (0.92 + 0.16 * h));
          }
          if (k % 2 === 0 && r % 2 === 0) put(h > 0.8 ? ':' : '·', b);   // forested lower flanks
        },
      },
      {
        name: 'far ridge', z: 0.07, occlude: true, fill: '#171716', static: true,
        span(k, S, t, out) { out[0] = farRidgeTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) {
          if (d < 1) return put(edge(farRidgeTop(k + 1, S.rows) - farRidgeTop(k - 1, S.rows), d), 0.3);
          if (k % 2 === 0 && r % 2 === 1) put('·', 0.22 - Math.min(0.08, d * 0.01));
        },
      },
      {
        name: 'mid ridge', z: 0.13, occlude: true, fill: '#151514', static: true,
        span(k, S, t, out) { out[0] = midRidgeTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) {
          midRidgeTop(k, S.rows);                             // sets firDx
          if (d < 1) {
            if (firDx !== 99 && Math.abs(firDx) < 1) return put('^', 0.22);
            return put(edge(midRidgeTop(k + 1, S.rows) - midRidgeTop(k - 1, S.rows), d), 0.18);
          }
          if (r < midRidgeBase(k, S.rows)) return;              // the little trees stay as silhouettes
          if (k % 3 === 1 && r % 2 === 0) put(hash(k, r, 43) > 0.75 ? ':' : '.', 0.17);
        },
      },
      {
        name: 'valley mist', z: 0.14, occlude: 'cell', merge: true, stop: false,
        span(k, S, t, out) { out[0] = S.rows * (HORIZON - 0.085); out[1] = S.rows * (HORIZON - 0.015); return true; },
        glyph(k, r, d, t, put) {
          const n = noise2(k * 0.018 - t * 0.05, r * 0.45, 101);
          if (n < 0.6 || hash(k, r, 102) < 0.3) return;
          put(n > 0.72 ? '─' : '-', 0.1 + 0.55 * (n - 0.6));
        },
      },
      {
        name: 'far firs', z: 0.2, occlude: true, fill: '#141413', static: true,
        span(k, S, t, out) { out[0] = farFirTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) { farFirTop(k, S.rows); if (firDx !== 99) firGlyph(k, r, d, put, 0.18, 63); },
      },
      {
        name: 'near firs', z: 0.3, occlude: true,
        span(k, S, t, out) { out[0] = nearFirTop(k, S.rows); out[1] = S.rows * HORIZON + 1; return true; },
        glyph(k, r, d, t, put, S) { nearFirTop(k, S.rows); firGlyph(k, r, d, put, 0.45, 73); },
      },
      {
        name: 'shore mist', z: 0.31, occlude: 'cell', merge: true, stop: false,
        span(k, S, t, out) { out[0] = S.rows * HORIZON - 2.5; out[1] = S.rows * HORIZON; return true; },
        glyph(k, r, d, t, put) {
          const n = noise1(k * 0.04 - t * 0.12, 111 + r);
          if (n < 0.6 || hash(k, r, 112) < 0.35) return;
          put(n > 0.75 ? '-' : '·', 0.12 + 0.4 * (n - 0.6));
        },
      },
      // The lake: four bands, each row with its own depth and speed.
      ...[[HORIZON, 0.68], [0.68, 0.78], [0.78, 0.9], [0.9, 1]].map((band, i) => ({
        name: 'lake ' + (i + 1), band, zAt: waterZ, occlude: true, stop: i === 0 || i === 3,
        glyph(k, r, rf, t, put, S, x) {
          const depth = (rf - HORIZON) / (1 - HORIZON);
          const n = noise2(k * 0.06, r * 0.85 + t * 0.16, 81);
          const v = n * (0.8 + 0.2 * Math.sin(t * 1.9 + k * 0.29 + r * 1.7));
          if (v < 0.27 + 0.14 * depth) return;                // ripples break the mirror into streaks
          // the row this cell mirrors - stretched 1.6x so the snowcap lands in the lake
          const hr = S.rows * HORIZON, mr = hr - (r + 0.5 - hr) * 1.6;
          const wobble = Math.sin(r * 1.37 + t * 1.1) * S.cw * (0.4 + 2.4 * depth);
          const refl = Math.max(0.22, sceneB(x + wobble, mr, S));
          const b = refl * (0.9 + 0.9 * (v - 0.45)) * (1 - 0.15 * depth);
          put(b > 0.32 ? '─' : v > 0.6 ? '-' : '·', b);
        },
      })),
      {
        name: 'boughs', z: 0.9, occlude: true, static: true,
        span(k, S, t, out) {
          const clump = noise1(k * 0.014, 121);
          if (clump < 0.58) return false;
          out[0] = -2;
          out[1] = S.rows * (0.02 + 0.5 * (clump - 0.58)) + 2 * noise1(k * 0.35, 122) + hash(k, 0, 123) * 1.6;
          return true;
        },
        glyph(k, r, d, t, put) {
          const h = hash(k, r, 124);
          if (h > 0.55) return;
          // drooping cedar sprays: \/\/ with the odd needle tuft
          put(h < 0.05 ? 'v' : h < 0.1 ? ',' : (k + r) & 1 ? '/' : '\\', 0.22 + h * 0.5);
        },
      },
    ],
  };
})(window);
