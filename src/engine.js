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
 * glyph, one row per brightness level), and layers that haven't moved by a
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
 *     fill: '#181817',         // silhouette colour (defaults to the background)
 *     static: true,            // glyph() doesn't depend on time -> cache it
 *     fps: 12,                 // ...or redraw at most this often
 *     merge: true,             // share the previous layer's canvas (and blur)
 *     stop: false,             // hide from the focus ticks in the UI
 *     span(col, S, t, out) {}, // set out[0]=top row, out[1]=bottom row for this
 *                              // world column; return false if nothing's there
 *     glyph(col, row, d, t, put, S, x) {}
 *                              // call put(char, brightness 0..1) for this cell.
 *                              // d = rows below the top of the span (can be
 *                              // fractional: the top row has d in (-0.5, 0.5])
 *   }
 *
 *   A "band" layer replaces span() with band: [topFraction, bottomFraction]
 *   and zAt(rowFraction), giving every row its own depth (ground planes,
 *   water). glyph() then receives the row fraction as `d`.
 */
(function (g) {
  'use strict';

  const NS = (g.AsciiBG = g.AsciiBG || {});
  NS.scenes = NS.scenes || {};
  const { clamp, smoothstep } = NS.noise;

  const LEVELS = 20;        // brightness steps in the atlas
  const MAX_BLUR = 3.2;     // css px of blur at full defocus, blur strength 1, 12px type
  const BASE_SPEED = 46;    // css px/s for a layer at z = 1, speed 1
  const PAR_X = 46;         // pointer parallax, css px at z = 1
  const PAR_Y = 10;

  const DEFAULTS = {
    scene: 'rockies',
    focus: null,            // null = the scene's own focus depth
    blur: 1,                // depth-of-field strength, 0 = everything sharp
    speed: 1,
    snap: false,            // lock every layer to one shared character grid
    pointer: true,          // pointer parallax
    autoRack: false,        // slowly sweep focus near <-> far
    fontSize: null,         // null = 12px desktop, 10px small screens
    lineHeight: 1.08,
    font: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    bg: '#121211',          // off-black
    ink: '#ece7dc',         // warm off-white
    fps: 60,
    maxDpr: 2,
    reducedMotion: true,    // respect prefers-reduced-motion
    start: 0,               // seconds of travel to skip ahead on load
    debug: false,
  };

  // A few glyphs are drawn as shapes so they look identical in every font.
  const SHAPES = {
    '·': (c, x, y, w, h) => dot(c, x, y, w, h, 0.2),
    '•': (c, x, y, w, h) => dot(c, x, y, w, h, 0.36),
    '■': (c, x, y, w, h) => dot(c, x, y, w, h, 0.62),
    '█': (c, x, y, w, h) => { const g = Math.max(1, Math.round(h * 0.12)); c.fillRect(x, y + g, w, h - g); },
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

  function rgb(hex) {
    const m = hex.replace('#', '');
    const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
    const bgRGB = rgb(o.bg), inkRGB = rgb(o.ink);

    // put(char, brightness) - the one function scenes use to draw.
    let curCtx = null, curX = 0, curY = 0, curDim = 1, curCell = false;
    const warned = {};
    function put(chr, b) {
      const v = b * curDim;
      if (v <= 0.02) return false;
      const gi = gIdx[chr];
      if (gi === undefined) {
        if (!warned[chr]) { warned[chr] = 1; console.warn('[ascii-bg] glyph not in scene.glyphs:', JSON.stringify(chr)); }
        return false;
      }
      let l = (v * LEVELS) | 0;
      if (l >= LEVELS) l = LEVELS - 1;
      if (curCell) curCtx.fillRect(curX, curY, CW, CH);
      curCtx.drawImage(atlas, gi * CW, l * CH, CW, CH, curX, curY, CW, CH);
      return true;
    }

    function emit(type, detail) { (listeners[type] || []).forEach((fn) => fn(detail)); }

    // ---- depth of field ----------------------------------------------------
    function blurFor(z) {
      return o.blur * MAX_BLUR * (fontSize / 12) * smoothstep(0.05, 0.7, Math.abs(z - focus));
    }
    function dimFor(z) {
      return 1 - Math.min(1, o.blur) * 0.35 * smoothstep(0.05, 0.85, Math.abs(z - focus));
    }
    function setFilter(G) {
      const b = blurFor(G.z);
      const f = b > 0.15 ? 'blur(' + b.toFixed(1) + 'px)' : 'none';
      if (f !== G.filter) { G.canvas.style.filter = f; G.filter = f; }
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
        if (!ld.merge || !groups.length) groups.push(makeGroup(zOf(L)));
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
      stats.canvases = groups.length;
      focus = firstScene && o.focus != null ? o.focus : def.focus;
      firstScene = false;
      scroll = 0;
      if (o.start) { t = o.start; scroll = o.start * BASE_SPEED * (o.fontSize || 12) / 12; }
      resize();
      emit('scene', { name, title: def.title });
      emit('focus', focus);
    }

    function resize() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(dprCap, g.devicePixelRatio || 1);
      fontSize = o.fontSize || (W < 640 ? 10 : 12);
      const m = document.createElement('canvas').getContext('2d');
      m.font = fontSize * dpr + 'px ' + o.font;
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
      const glyphs = Array.from(new Set(Array.from(' ' + (scene ? scene.glyphs : ''))));
      atlas = document.createElement('canvas');
      atlas.width = CW * glyphs.length; atlas.height = CH * LEVELS;
      const c = atlas.getContext('2d');
      c.font = fontSize * dpr + 'px ' + o.font;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      gIdx = Object.create(null);
      glyphs.forEach((gl, i) => { gIdx[gl] = i; });
      for (let l = 0; l < LEVELS; l++) {
        const k = (l + 1) / LEVELS;
        const col = bgRGB.map((v, i) => Math.round(v + (inkRGB[i] - v) * k));
        c.fillStyle = 'rgb(' + col.join(',') + ')';
        glyphs.forEach((gl, i) => {
          const x = i * CW, y = l * CH;
          c.save(); c.beginPath(); c.rect(x, y, CW, CH); c.clip();
          if (SHAPES[gl]) SHAPES[gl](c, x, y, CW, CH);
          else c.fillText(gl, x + CW / 2, y + CH / 2 + CH * 0.04);
          c.restore();
        });
      }
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
      L.dim = dimFor(z);
      const key = L.offDev + ':' + L.dyDev + ':' + Math.round(L.dim * 100) + ':' + epoch;
      const timed = d.fps ? t - L.lastT >= 1 / d.fps : false;
      L.dirty = !(d.static || d.fps) || key !== L.key || timed;
      L.nextKey = key;
    }

    // putAt(x css px, row, char, brightness) - for free-moving things (birds)
    let curDy = 0;
    function putAt(x, row, chr, b) {
      curX = Math.round(x * dpr - CW / 2);
      curY = Math.round(row) * CH + curDy;
      return put(chr, b);
    }

    function drawSpan(L, ctx) {
      const d = L.def, offDev = L.offDev, dyDev = L.dyDev;
      if (d.custom) {
        curCtx = ctx; curDim = L.dim; curCell = d.occlude === 'cell'; curDy = dyDev;
        ctx.fillStyle = d.fill || o.bg;
        d.custom(S, t, putAt);
        L.key = L.nextKey; L.lastT = t;
        return;
      }
      const k0 = Math.floor(offDev / CW), kN = k0 + cols + 1;
      const occ = d.occlude === true;
      curCtx = ctx; curDim = L.dim; curCell = d.occlude === 'cell';
      ctx.fillStyle = d.fill || o.bg;
      for (let k = k0; k <= kN; k++) {
        if (!d.span(k, S, t, SPAN)) continue;
        const r0 = Math.max(-2, Math.round(SPAN[0])), r1 = Math.min(rows + 2, Math.round(SPAN[1]));
        if (r1 <= r0) continue;
        const xDev = k * CW - offDev;
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
      curCtx = ctx; curCell = d.occlude === 'cell';
      ctx.fillStyle = d.fill || o.bg;
      if (d.occlude === true) ctx.fillRect(0, r0 * CH + dyDev, Wd, (r1 - r0) * CH);
      for (let r = r0; r < r1; r++) {
        const rf = (r + 0.5) / rows;
        const z = d.zAt(rf);
        const off = scroll * z + pointer.x * PAR_X * z;
        L.rowOff[Math.max(0, r)] = off;
        const offDev = o.snap ? Math.round(off / cw) * CW : Math.round(off * dpr);
        const k0 = Math.floor(offDev / CW), kN = k0 + cols + 1;
        curDim = dimFor(z);
        curY = r * CH + dyDev;
        for (let k = k0; k <= kN; k++) {
          curX = k * CW - offDev;
          d.glyph(k, r, rf, t, put, S, curX / dpr);
        }
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
      if (!paused) { t += dt; scroll += dt * BASE_SPEED * o.speed * (fontSize / 12); }
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
      document.fonts.load(fontSize + 'px ' + o.font).then(() => resize()).catch(() => {});
    }
    return api;
  }

  NS.create = create;
})(window);
