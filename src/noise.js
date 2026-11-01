/*
 * Tiny deterministic noise helpers.
 * Everything is seeded and pure, so a given world column always produces the
 * same mountain / tree / blade of grass however far you've scrolled.
 */
(function (g) {
  'use strict';

  // Integer hash -> [0, 1)
  function hash(x, y, seed) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x5bd1e995, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smoothstep = (e0, e1, v) => smooth(clamp((v - e0) / (e1 - e0), 0, 1));

  // 1D value noise -> [0, 1)
  function noise1(x, seed) {
    const i = Math.floor(x);
    return lerp(hash(i, 0, seed), hash(i + 1, 0, seed), smooth(x - i));
  }

  // 2D value noise -> [0, 1)
  function noise2(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = lerp(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx);
    const b = lerp(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx);
    return lerp(a, b, fy);
  }

  // Fractal sum of 1D noise -> [0, 1)
  function fbm1(x, seed, octaves) {
    let amp = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < (octaves || 4); o++) {
      sum += amp * noise1(x, seed + o * 101);
      norm += amp;
      x *= 2.03;
      amp *= 0.5;
    }
    return sum / norm;
  }

  // Ridged fractal noise: sharp peaks, good for jagged mountains -> [0, 1)
  function ridged1(x, seed, octaves) {
    let amp = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < (octaves || 4); o++) {
      const n = 1 - Math.abs(noise1(x, seed + o * 131) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      x *= 2.1;
      amp *= 0.5;
    }
    return sum / norm;
  }

  (g.AsciiBG = g.AsciiBG || {}).noise = { hash, noise1, noise2, fbm1, ridged1, lerp, clamp, smooth, smoothstep };
})(window);
