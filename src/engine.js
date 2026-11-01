/*
 * ASCII depth engine
 * ------------------
 * A scene is a stack of layers, back to front. Layers are drawn onto stacked
 * <canvas> elements, which buys three things almost for free:
 *
 *   1. Parallax  - each layer scrolls at a speed proportional to its depth `z`
 *                  (0 = horizon, 1 = right in front of the camera).
 *   2. Occlusion - a layer paints a background-coloured silhouette under its
 *                  characters, so nearer things hide farther things.
 *   3. Depth of field - each canvas gets a CSS blur based on how far its `z`
 *                  is from the focus depth, and its characters are dimmed by
 *                  the same amount. Move the focus and the scene "racks".
 *
 * Characters are stamped from a pre-rendered glyph atlas (one column per
 * glyph, one row per ink colour, drawn at any opacity), and layers that haven't moved by a
 * whole device pixel aren't redrawn, so far-away layers cost almost nothing.
 *
 * Layer definition (see src/scenes/*.js for real ones):
 *
 *   {
 *     name: 'mountains',
 *     z: 0.42,                 // depth: parallax speed + depth of field
 *     fixed: false,            // true = never scrolls (moon, sky)
 *     occlude: true,           // true = solid silhouette, 'cell' = only the
 *                              // cells you draw, false = transparent
 *     fill: '#8a9bb0',         // silhouette colour, or fill(col, S) for a colour
 *                              // per column (band layers: fill(rowFraction, S))
 *     ink: 'snow',             // default ink for put() (a key of scene.inks)
 *     static: true,            // glyph() doesn't depend on time: the layer is drawn
 *                              // once into an off-screen strip and slid into place
 *     screenSpace: true,       // glyph() depends on screen x: redraw instead of sliding
 *     fps: 12,                 // ...or redraw at most this often
 *     merge: true,             // share the previous layer's canvas (and blur)
 *     stop: false,             // hide from the focus ticks in the UI
 *     span(col, S, t, out) {}, // set out[0]=top row, out[1]=bottom row for this
 *                              // world column; return false if nothing's there
 *     glyph(col, row, d, t, put, S, x) {}
 *                              // call put(char, opacity 0..1, ink?) for this cell;
 *                              // call it twice to stack (e.g. a block + a stroke).
 *                              // d = rows below the top of the span (can be
 *                              // fractional: the top row has d in (-0.5, 0.5])
 *   }
 *
 *   A "band" layer replaces span() with band: [topFraction, bottomFraction]
 *   and zAt(rowFraction), giving every row its own depth (ground planes,
 *   water). glyph() then receives the row fraction as `d`. Each row is cached
 *   as a strip and redrawn only when it has moved a whole column or its
 *   animation ticks (animFps, default 12), so glyph() sees a stepped `t`.
 *
 * A scene can set fontSize / fontSizeSmall (px) for its type size on large /
 * small (< 640px) screens; smaller type means more detail. Small type also
 * wants: fontWeight, inkGamma (< 1 darkens faint strokes) and blurScale.
 * A layer with cssDim: true is dimmed with CSS opacity instead of being
 * redrawn when focus moves (only for layers that don't need to hide others).
 */
(function (g) {
  'use strict';

  const NS = (g.AsciiBG = g.AsciiBG || {});
  NS.scenes = NS.scenes || {};
  const { clamp, smoothstep } = NS.noise;

  const MAX_BLUR = 2.6;     // css px of blur at full defocus, blur strength 1, 12px type
  const BASE_SPEED = 46;    // css px/s for a layer at z = 1, speed 1
  const PAR_X = 46;         // pointer parallax, css px at z = 1
  const PAR_Y = 10;

  const DEFAULTS = {
    scene: 'vista',
    focus: null,            // null = the scene's own focus depth
    blur: 1,                // depth-of-field strength, 0 = everything sharp
    speed: 1,
    snap: false,            // lock every layer to one shared character grid
    pointer: false,         // pointer parallax (off by default)
    autoRack: false,        // slowly sweep focus near <-> far
    fontSize: null,         // null = 12px desktop, 10px small screens
    lineHeight: 1.08,
    fontWeight: 500,        // a little heavier reads better as ink on paper
    font: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    bg: '#ecebe7',          // paper
    ink: '#1c1b19',         // ink
    fps: 60,
    maxDpr: 2,
    reducedMotion: true,    // respect prefers-reduced-motion
    start: null,            // seconds of travel to skip ahead on load (null = the scene's own)
    debug: false,
  };

  // A few glyphs are drawn as shapes so they look identical in every font.
  const SHAPES = {
    '·': (c, x, y, w, h) => dot(c, x, y, w, h, 0.2),
    '•': (c, x, y, w, h) => dot(c, x, y, w, h, 0.36),
    '■': (c, x, y, w, h) => dot(c, x, y, w, h, 0.62),
    '□': (c, x, y, w, h) => {
      const s = Math.max(3, Math.round(w * 0.62)), lw = Math.max(1, Math.round(w * 0.12));
      const x0 = Math.round(x + (w - s) / 2), y0 = Math.round(y + (h - s) / 2);
      c.fillRect(x0, y0, s, lw); c.fillRect(x0, y0 + s - lw, s, lw);
      c.fillRect(x0, y0, lw, s); c.fillRect(x0 + s - lw, y0, lw, s);
    },
    '█': (c, x, y, w, h) => c.fillRect(x, y, w, h),
    '▆': (c, x, y, w, h) => { const g = Math.max(1, Math.round(h * 0.12)); c.fillRect(x, y + g, w, h - g); },
    '─': (c, x, y, w, h) => { const t = Math.max(1, Math.round(h * 0.08)); c.fillRect(x, Math.round(y + h / 2 - t / 2), w, t); },
    '━': (c, x, y, w, h) => { const t = Math.max(2, Math.round(h * 0.16)); c.fillRect(x, Math.round(y + h / 2 - t / 2), w, t); },
    '▲': (c, x, y, w, h) => {
      const s = Math.max(3, Math.round(w * 0.55));
      const cx = x + w / 2, by = Math.round(y + h / 2 + s / 2);
      c.beginPath(); c.moveTo(cx - s / 2, by); c.lineTo(cx + s / 2, by); c.lineTo(cx, by - s); c.closePath(); c.fill();
    },
  };
  function dot(c, x, y, w, h, k) {
    const s = Math.max(1, Math.round(w * k));
    c.fillRect(Math.round(x + (w - s) / 2), Math.round(y + (h - s) / 2), s, s);
  }


  /*
   * Pick a character for the top edge of a silhouette, so ridgelines read as
   * smooth lines instead of staircases.
   *   slope: change in top row per column (negative = rising to the right)
   *   d:     the `d` passed to glyph() for the top row
   */
  NS.edge = function (slope, d) {
    if (slope < -0.8) return '/';
    if (slope > 0.8) return '\\';
    const f = 0.5 - d;                 // where the edge crosses the cell, 0 = top
    if (f < 0.3) return slope < -0.35 ? '/' : slope > 0.35 ? '\\' : "'";
    if (f < 0.68) return '-';
    return slope < -0.35 ? ',' : slope > 0.35 ? '.' : '_';
  };

  function create(container, options) {
    options = Object.fromEntries(Object.entries(options || {}).filter(([, v]) => v !== undefined));
    const o = Object.assign({}, DEFAULTS, options);
    const reduce = o.reducedMotion && g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce && options.speed == null) o.speed = 0.15;

    const root = document.createElement('div');
    root.className = 'ascii-bg';
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: o.bg, pointerEvents: 'none' });
    container.appendChild(root);

    // ---- state -----------------------------------------------------------
    let scene = null, sceneName = '';
    let layers = [];         // scene layers, back to front
    let groups = [];         // canvases: { canvas, ctx, layers, z, sprite? }
    let sprite = null;
    let dpr = 1, W = 0, H = 0, Wd = 0, Hd = 0, fontSize = 12, CW = 7, CH = 13, cw = 7, ch = 13, cols = 0, rows = 0;
    let atlas = null, gIdx = Object.create(null), epoch = 0;
    let scroll = 0, t = 0, last = 0, raf = 0, paused = false, rackT = 0, lastSig = '';
    let slow = 0, dprCap = o.maxDpr;   // drop to 1x if a device can't keep up
    let focus = o.focus, firstScene = true;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const listeners = {};
    const stats = { ms: 0, drawn: 0, canvases: 0, groups: {} };
    const S = { W: 0, H: 0, cw: 0, ch: 0, cols: 0, rows: 0, dpr: 1, fontSize: 12, layers: {} };
    const SPAN = [0, 0];
    let inkIdx = Object.create(null);

    // put(char, opacity, ink) - the one function scenes use to draw.
    let curCtx = null, curX = 0, curY = 0, curDim = 1, curCell = false, curInk = 0;
    const warned = {};
    function put(chr, b, ink) {
      let v = b * curDim;
      if (v <= 0.02) return false;
      if (gammaLUT) v = gammaLUT[(v > 1 ? 1 : v) * 255 | 0];
      const gi = gIdx[chr];
      const row = ink === undefined ? curInk : inkIdx[ink];
      if (gi === undefined || row === undefined) {
        const what = gi === undefined ? 'glyph not in scene.glyphs: ' + JSON.stringify(chr) : 'ink not in scene.inks: ' + ink;
        if (!warned[what]) { warned[what] = 1; console.warn('[ascii-bg] ' + what); }
        return false;
      }
      if (curCell) { curCtx.globalAlpha = 1; curCtx.fillRect(curX, curY, CW, CH); }
      curCtx.globalAlpha = v > 1 ? 1 : v;
      curCtx.drawImage(atlas, gi * CW, row * CH, CW, CH, curX, curY, CW, CH);
      return true;
    }

    const weight = () => (scene && scene.fontWeight) || o.fontWeight;
    let gammaLUT = null;                     // opacity curve for the scene's inkGamma

    function emit(type, detail) { (listeners[type] || []).forEach((fn) => fn(detail)); }

    // ---- depth of field ----------------------------------------------------
    function blurFor(z) {
      return o.blur * MAX_BLUR * ((scene && scene.blurScale) || 1) * Math.sqrt(fontSize / 12) * smoothstep(0.03, 0.6, Math.abs(z - focus));
    }
    function dimFor(z) {
      return Math.round((1 - Math.min(1, o.blur) * 0.3 * smoothstep(0.03, 0.6, Math.abs(z - focus))) * 20) / 20;
    }
    function setFilter(G) {
      const b = blurFor(G.z);
      const f = b > 0.15 ? 'blur(' + b.toFixed(1) + 'px)' : 'none';
      if (f !== G.filter) { G.canvas.style.filter = f; G.filter = f; }
      if (G.cssDim) {
        const op = String(dimFor(G.z));
        if (op !== G.opacity) { G.canvas.style.opacity = op; G.opacity = op; }
      }
    }
    const zOf = (L) => (L.def.band ? L.zMean : L.def.z);

    // ---- setup -------------------------------------------------------------
    function makeGroup(z) {
      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      return { canvas, ctx: canvas.getContext('2d'), layers: [], z, filter: '' };
    }

    function setScene(name) {
      const def = NS.scenes[name];
      if (!def) throw new Error('[ascii-bg] unknown scene "' + name + '"');
      scene = def; sceneName = name;
      root.textContent = '';
      S.layers = {};
      groups = [];
      layers = def.layers.map((ld) => {
        const L = { def: ld, off: 0, offDev: 0, dyDev: 0, dim: 1, key: '', lastT: -1, rowOff: null };
        if (ld.band) L.zMean = (ld.zAt(ld.band[0]) + ld.zAt(ld.band[1])) / 2;
        if (!ld.merge || !groups.length) { groups.push(makeGroup(zOf(L))); groups[groups.length - 1].cssDim = !!ld.cssDim; }
        L.group = groups[groups.length - 1];
        L.group.layers.push(L);
        S.layers[ld.name] = L;
        return L;
      });
      sprite = null;
      if (def.sprite) {
        sprite = makeGroup(def.sprite.z);
        sprite.def = def.sprite; sprite.isSprite = true;
        const i = groups.findIndex((G) => G.layers.some((L) => (L.def.band ? L.def.zAt(L.def.band[0]) : L.def.z) > sprite.z));
        groups.splice(i < 0 ? groups.length : i, 0, sprite);
      }
      groups.forEach((G) => root.appendChild(G.canvas));
      root.style.background = def.background || o.bg;
      stats.canvases = groups.length;
      focus = firstScene && o.focus != null ? o.focus : def.focus;
      // where to start: seconds of travel, or the scene's start(S) giving a scroll position
      const start = firstScene && o.start != null ? o.start : def.start || 0;
      firstScene = false;
      t = 0; scroll = 0;
      resize();
      if (typeof start === 'function') scroll = start(S);
      else scroll = start * BASE_SPEED;
      t = scroll / BASE_SPEED;
      lastSig = ''; render();
      emit('scene', { name, title: def.title });
      emit('focus', focus);
    }

    function resize() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(dprCap, g.devicePixelRatio || 1);
      const small = W < 640;
      fontSize = o.fontSize || (small ? (scene && scene.fontSizeSmall) || 10 : (scene && scene.fontSize) || 12);
      const m = document.createElement('canvas').getContext('2d');
      m.font = weight() + ' ' + fontSize * dpr + 'px ' + o.font;
      CW = Math.max(2, Math.round(m.measureText('M').width));
      CH = Math.max(3, Math.round(fontSize * dpr * o.lineHeight));
      cw = CW / dpr; ch = CH / dpr;
      cols = Math.ceil(W / cw) + 1; rows = Math.ceil(H / ch);
      Wd = Math.round(W * dpr); Hd = Math.round(H * dpr);
      groups.forEach((G) => { G.canvas.width = Wd; G.canvas.height = Hd; });
      Object.assign(S, { W, H, cw, ch, cols, rows, dpr, fontSize });
      buildAtlas();
      if (scene && scene.setup) scene.setup(S);
      if (sprite) buildSprite();
      epoch++; lastSig = '';
      render();
    }

    function buildAtlas() {
      const gm = scene && scene.inkGamma;
      gammaLUT = gm && gm !== 1 ? Float32Array.from({ length: 256 }, (_, i) => Math.pow(i / 255, gm)) : null;
      const glyphs = Array.from(new Set(Array.from(' ' + (scene ? scene.glyphs : ''))));
      atlas = document.createElement('canvas');
      const inks = Object.assign({ ink: o.ink }, scene ? scene.inks : null);
      const names = Object.keys(inks);
      atlas.width = CW * glyphs.length; atlas.height = CH * names.length;
      const c = atlas.getContext('2d');
      c.font = weight() + ' ' + fontSize * dpr + 'px ' + o.font;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      gIdx = Object.create(null);
      glyphs.forEach((gl, i) => { gIdx[gl] = i; });
      inkIdx = Object.create(null);
      names.forEach((name, l) => {
        inkIdx[name] = l;
        c.fillStyle = inks[name];
        glyphs.forEach((gl, i) => {
          const x = i * CW, y = l * CH;
          c.save(); c.beginPath(); c.rect(x, y, CW, CH); c.clip();
          if (SHAPES[gl]) SHAPES[gl](c, x, y, CW, CH);
          else c.fillText(gl, x + CW / 2, y + CH / 2 + CH * 0.04);
          c.restore();
        });
      });
    }

    function buildSprite() {
      const d = sprite.def;
      const scale = d.scale || Math.max(2, Math.round(fontSize / 3.2));
      const px = Math.max(1, Math.round(scale * dpr));
      const art = d.art;
      const w = Math.max(...art.map((r) => r.length)), h = art.length;
      const c = document.createElement('canvas');
      c.width = w * px; c.height = h * px;
      const x = c.getContext('2d');
      art.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const col = d.palette[row[rx]];
          if (!col) continue;
          x.fillStyle = col;
          x.fillRect(rx * px, ry * px, px, px);
        }
      });
      sprite.img = c; sprite.px = px; sprite.w = c.width; sprite.h = c.height;
    }

    // ---- rendering -----------------------------------------------------------
    // Work out where a span layer sits this frame and whether it needs redrawing.
    function prepare(L) {
      const d = L.def;
      if (d.band) { L.dirty = true; return; }
      const z = d.z;
      L.off = (d.fixed ? 0 : scroll * z) + pointer.x * PAR_X * Math.max(z, 0.02);
      L.offDev = o.snap ? Math.round(L.off / cw) * CW : Math.round(L.off * dpr);
      L.dyDev = Math.round(-pointer.y * PAR_Y * z * dpr);
      L.dim = L.group.cssDim ? 1 : dimFor(z);
      const key = L.offDev + ':' + L.dyDev + ':' + Math.round(L.dim * 100) + ':' + epoch;
      const timed = d.fps ? t - L.lastT >= 1 / d.fps : false;
      L.dirty = !(d.static || d.fps) || key !== L.key || timed;
      L.nextKey = key;
    }

    // putAt(x css px, row, char, brightness) - for free-moving things (birds)
    let curDy = 0;
    function putAt(x, row, chr, b, ink) {
      curX = Math.round(x * dpr - CW / 2);
      curY = Math.round(row) * CH + curDy;
      return put(chr, b, ink);
    }

    // A static, moving layer is drawn once into an off-screen strip a screen and
    // a half wide (only as tall as it needs), then slid into place each frame.
    function drawSpanCached(L, ctx) {
      const d = L.def, offDev = L.offDev;
      const k0 = Math.floor(offDev / CW), kN = k0 + cols + 1;
      const key = Math.round(L.dim * 100) + ':' + epoch;
      let C = L.cache;
      if (!C) { const c = document.createElement('canvas'); C = L.cache = { canvas: c, ctx: c.getContext('2d'), key: '', kA: 1, kB: 0, w: 0, h: 0, rMin: 0 }; }
      if (C.key !== key || k0 < C.kA || kN > C.kB) {
        const kA = k0 - 2, kB = kN + Math.ceil(cols * 0.5) + 2, n = kB - kA + 1;
        if (!L.spanBuf || L.spanBuf.length < n * 2) L.spanBuf = new Float64Array(n * 2);
        const sb = L.spanBuf;
        let rMin = Infinity, rMax = -Infinity;
        for (let i = 0; i < n; i++) {
          sb[i * 2] = NaN;
          if (!d.span(kA + i, S, t, SPAN)) continue;
          const r0 = Math.max(-2, Math.round(SPAN[0])), r1 = Math.min(rows + 2, Math.round(SPAN[1]));
          if (r1 <= r0) continue;
          sb[i * 2] = SPAN[0]; sb[i * 2 + 1] = SPAN[1];
          if (r0 < rMin) rMin = r0;
          if (r1 > rMax) rMax = r1;
        }
        C.kA = kA; C.kB = kB; C.key = key; C.w = 0;
        if (rMin !== Infinity) {
          const w = n * CW, h = (rMax - rMin) * CH, cv = C.canvas;
          if (cv.width < w || cv.height < h) { cv.width = Math.max(w, cv.width); cv.height = Math.max(h, cv.height); }
          else { C.ctx.globalAlpha = 1; C.ctx.clearRect(0, 0, cv.width, cv.height); }
          C.w = w; C.h = h; C.rMin = rMin;
          const cc = C.ctx, occ = d.occlude === true, fillFn = typeof d.fill === 'function' ? d.fill : null;
          curCtx = cc; curDim = L.dim; curCell = d.occlude === 'cell';
          curInk = inkIdx[d.ink || 'ink'] || 0;
          cc.fillStyle = fillFn ? o.bg : d.fill || o.bg;
          for (let i = 0; i < n; i++) {
            const s0 = sb[i * 2];
            if (s0 !== s0) continue;
            const k = kA + i;
            const r0 = Math.max(-2, Math.round(s0)), r1 = Math.min(rows + 2, Math.round(sb[i * 2 + 1]));
            const xDev = i * CW;
            if (fillFn) cc.fillStyle = fillFn(k, S);
            cc.globalAlpha = 1;
            if (occ) cc.fillRect(xDev, (r0 - rMin) * CH, CW, (r1 - r0) * CH);
            curX = xDev;
            const x = (k * CW - offDev) / dpr;
            for (let r = r0; r < r1; r++) {
              curY = (r - rMin) * CH;
              d.glyph(k, r, r - s0, t, put, S, x);
            }
          }
        }
      }
      if (C.w) { ctx.globalAlpha = 1; ctx.drawImage(C.canvas, 0, 0, C.w, C.h, C.kA * CW - offDev, C.rMin * CH + L.dyDev, C.w, C.h); }
      L.key = L.nextKey; L.lastT = t;
    }

    function drawSpan(L, ctx) {
      const d = L.def, offDev = L.offDev, dyDev = L.dyDev;
      if (d.static && !d.fixed && !d.screenSpace && d.cache !== false && !d.custom) return drawSpanCached(L, ctx);
      if (d.custom) {
        curCtx = ctx; curDim = L.dim; curCell = d.occlude === 'cell'; curDy = dyDev;
        curInk = inkIdx[d.ink || 'ink'] || 0;
        ctx.fillStyle = typeof d.fill === 'string' ? d.fill : o.bg;
        d.custom(S, t, putAt);
        L.key = L.nextKey; L.lastT = t;
        return;
      }
      const k0 = Math.floor(offDev / CW), kN = k0 + cols + 1;
      const occ = d.occlude === true;
      const fillFn = typeof d.fill === 'function' ? d.fill : null;
      curCtx = ctx; curDim = L.dim; curCell = d.occlude === 'cell';
      curInk = inkIdx[d.ink || 'ink'] || 0;
      ctx.fillStyle = fillFn ? o.bg : d.fill || o.bg;
      for (let k = k0; k <= kN; k++) {
        if (!d.span(k, S, t, SPAN)) continue;
        const r0 = Math.max(-2, Math.round(SPAN[0])), r1 = Math.min(rows + 2, Math.round(SPAN[1]));
        if (r1 <= r0) continue;
        const xDev = k * CW - offDev;
        if (fillFn) ctx.fillStyle = fillFn(k, S);
        ctx.globalAlpha = 1;
        if (occ) ctx.fillRect(xDev, r0 * CH + dyDev, CW, (r1 - r0) * CH);
        curX = xDev;
        const x = xDev / dpr;
        for (let r = r0; r < r1; r++) {
          curY = r * CH + dyDev;
          d.glyph(k, r, r - SPAN[0], t, put, S, x);
        }
      }
      L.key = L.nextKey; L.lastT = t;
    }

    function drawBand(L, ctx) {
      const d = L.def;
      const r0 = Math.round(d.band[0] * rows);
      const r1 = d.band[1] >= 1 ? rows + 2 : Math.round(d.band[1] * rows);
      const dyDev = Math.round(-pointer.y * PAR_Y * L.zMean * dpr);
      if (!L.rowOff || L.rowOff.length < rows + 3) L.rowOff = new Float32Array(rows + 3);
      if (!L.strips) L.strips = [];
      const fillFn = typeof d.fill === 'function' ? d.fill : null;
      curCtx = ctx; curCell = d.occlude === 'cell';
      curInk = inkIdx[d.ink || 'ink'] || 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = fillFn ? o.bg : d.fill || o.bg;
      if (d.occlude === true && !fillFn) ctx.fillRect(0, r0 * CH + dyDev, Wd, (r1 - r0 + 3) * CH);
      for (let r = r0; r < r1; r++) {
        const rf = (r + 0.5) / rows;
        if (fillFn && d.occlude === true) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = fillFn(rf, S);
          // the last row's fill runs a few rows on, under the next band, so blurred
          // band edges never show a seam
          ctx.fillRect(0, r * CH + dyDev, Wd, r === r1 - 1 ? CH * 4 : CH + 1);
        }
        const z = d.zAt(rf);
        const off = scroll * z + pointer.x * PAR_X * z;
        L.rowOff[Math.max(0, r)] = off;
        const offDev = o.snap ? Math.round(off / cw) * CW : Math.round(off * dpr);
        const k0 = Math.floor(offDev / CW);
        const dim = dimFor(z);
        // each row is a cached strip: redrawn when it moves a whole column or its
        // animation ticks (staggered across rows so the work is spread out)
        const fps = d.animFps || 12, phase = (r * 0.618034) % 1;
        const tick = Math.floor(t * fps + phase);
        const key = k0 + ':' + tick + ':' + dim + ':' + epoch;
        let st = L.strips[r];
        if (!st) { const c = document.createElement('canvas'); st = L.strips[r] = { canvas: c, ctx: c.getContext('2d'), key: '' }; }
        if (st.key !== key) {
          const w = (cols + 2) * CW, sc = st.ctx;
          if (st.canvas.width !== w || st.canvas.height !== CH) { st.canvas.width = w; st.canvas.height = CH; }
          else { sc.globalAlpha = 1; sc.clearRect(0, 0, w, CH); }
          sc.fillStyle = (fillFn ? fillFn(rf, S) : d.fill) || o.bg;
          curCtx = sc; curDim = dim; curY = 0;
          const tq = (tick - phase) / fps;
          for (let k = k0, kN = k0 + cols + 1; k <= kN; k++) {
            curX = (k - k0) * CW;
            d.glyph(k, r, rf, tq, put, S, (k * CW - offDev) / dpr);
          }
          st.key = key;
        }
        ctx.globalAlpha = 1;
        ctx.drawImage(st.canvas, k0 * CW - offDev, r * CH + dyDev);
      }
    }

    function drawSprite(G) {
      const d = G.def, ctx = G.ctx;
      ctx.clearRect(0, 0, Wd, Hd);
      const bob = Math.sin(t * (d.bobSpeed || 1.6)) * (d.bob == null ? 1 : d.bob) * G.px;
      const x = Math.round(d.x * Wd - G.w / 2 - pointer.x * PAR_X * d.z * dpr);
      const y = Math.round(d.y * Hd - G.h + bob - pointer.y * PAR_Y * d.z * dpr);
      const info = { x, y, w: G.w, h: G.h, px: G.px, t, dpr, CW, CH };
      if (d.under) d.under(ctx, info);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(G.img, x, y);
      if (d.over) d.over(ctx, info);
    }

    function render() {
      if (!scene || !atlas) return;
      const t0 = performance.now();
      stats.drawn = 0;
      for (const G of groups) {
        setFilter(G);
        if (G.isSprite) { if (G.img) drawSprite(G); continue; }
        let dirty = false;
        for (const L of G.layers) { prepare(L); dirty = dirty || L.dirty; }
        if (!dirty) continue;
        const tg = o.debug ? performance.now() : 0;
        G.ctx.globalAlpha = 1;
        G.ctx.clearRect(0, 0, Wd, Hd);
        for (const L of G.layers) {
          if (L.def.band) drawBand(L, G.ctx);
          else drawSpan(L, G.ctx);
        }
        stats.drawn++;
        if (o.debug) { const n = G.layers[0].def.name; stats.groups[n] = (stats.groups[n] || 0) * 0.9 + (performance.now() - tg) * 0.1; }
      }
      stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      const elapsed = (now - last) / 1000;
      if (o.fps < 60 && elapsed < 1 / o.fps - 0.002) return;
      last = now;
      const dt = Math.min(elapsed, 0.1);
      // adaptive quality: ~2s of sub-40fps frames at >1x pixel ratio -> render at 1x
      if (dpr > 1 && !paused) {
        slow = elapsed > 0.025 && elapsed < 0.2 ? slow + 1 : Math.max(0, slow - 2);
        if (slow > 80) { dprCap = 1; slow = 0; resize(); }
      }
      if (!paused) { t += dt; scroll += dt * BASE_SPEED * o.speed; }
      if (o.autoRack) {
        rackT += dt;
        const zs = layers.map(zOf);
        const lo = Math.min(...zs), hi = Math.max(...zs);
        focus = lo + (hi - lo) * (0.5 - 0.5 * Math.cos(rackT * 0.45));
        emit('focus', focus);
      }
      const k = 1 - Math.exp(-dt * 3);
      pointer.x += (pointer.tx - pointer.x) * k;
      pointer.y += (pointer.ty - pointer.y) * k;
      // nothing changed (paused, pointer at rest) -> skip the frame entirely
      const sig = t + '|' + scroll + '|' + pointer.x.toFixed(4) + '|' + pointer.y.toFixed(4) + '|' + focus + '|' + o.blur + '|' + o.snap;
      if (sig === lastSig) return;
      lastSig = sig;
      render();
    }

    // ---- input -------------------------------------------------------------
    function onPointer(e) {
      if (!o.pointer) return;
      pointer.tx = clamp((e.clientX / g.innerWidth) * 2 - 1, -1, 1);
      pointer.ty = clamp((e.clientY / g.innerHeight) * 2 - 1, -1, 1);
    }
    g.addEventListener('pointermove', onPointer, { passive: true });
    const ro = new ResizeObserver(() => resize());
    ro.observe(root);

    // ---- api ----------------------------------------------------------------
    const api = {
      setScene,
      get scene() { return sceneName; },
      get focus() { return focus; },
      setFocus(z) { focus = clamp(+z, 0, 1); if (o.autoRack) { o.autoRack = false; emit('autorack', false); } emit('focus', focus); },
      setBlur(v) { o.blur = Math.max(0, +v); },
      setSpeed(v) { o.speed = +v; },
      setSnap(v) { o.snap = !!v; },
      setPointer(v) { o.pointer = !!v; if (!v) { pointer.tx = 0; pointer.ty = 0; } },
      setAutoRack(v) {
        o.autoRack = !!v;
        // start the sweep from wherever focus is now, so it doesn't jump
        const zs = layers.map(zOf);
        const lo = Math.min(...zs), hi = Math.max(...zs);
        rackT = Math.acos(clamp(1 - 2 * (focus - lo) / (hi - lo || 1), -1, 1)) / 0.45;
        emit('autorack', o.autoRack);
      },
      get options() { return Object.assign({}, o); },
      get stats() { return Object.assign({}, stats); },
      pause() { paused = true; emit('pause', true); },
      play() { paused = false; emit('pause', false); },
      get paused() { return paused; },
      // Depth stops for the UI: named layers + the sprite, back to front.
      stops() {
        const s = layers.filter((L) => L.def.stop !== false).map((L) => ({ name: L.def.name, z: zOf(L) }));
        if (sprite) s.push({ name: sprite.def.name || 'subject', z: sprite.z });
        return s.sort((a, b) => a.z - b.z);
      },
      on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return api; },
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); g.removeEventListener('pointermove', onPointer); root.remove(); },
    };

    setScene(o.scene);
    raf = requestAnimationFrame(frame);
    // Rebuild the atlas once the web font has arrived.
    if (document.fonts && document.fonts.load) {
      document.fonts.load(weight() + ' ' + fontSize + 'px ' + o.font).then(() => resize()).catch(() => {});
    }
    return api;
  }

  NS.create = create;
})(window);
