/*
 * Small control panel for poking at the effect. Not needed when you use the
 * engine as a plain background - see example.html.
 */
(function (g) {
  'use strict';
  const NS = g.AsciiBG;

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
  }

  function store(key, value) {
    try {
      if (value === undefined) return g.localStorage.getItem(key);
      g.localStorage.setItem(key, value);
    } catch (e) { /* private mode etc. */ }
    return null;
  }

  NS.ui = function (bg, opts) {
    opts = opts || {};
    const scenes = opts.scenes || Object.keys(NS.scenes);
    let tween = 0;

    // --- focus, with clickable depth stops -----------------------------------
    const focus = el('input', { type: 'range', min: '0', max: '1', step: '0.001', id: 'ab-focus', 'aria-label': 'Focus depth' });
    const focusOut = el('output', { for: 'ab-focus' });
    const ticks = el('div', { class: 'ab-ticks', 'aria-hidden': 'true' });
    function nearestStop(z) {
      return bg.stops().reduce((best, s) => (Math.abs(s.z - z) < Math.abs(best.z - z) ? s : best));
    }
    function showFocus(z) {
      focus.value = z;
      focus.style.setProperty('--p', (z * 100).toFixed(2) + '%');
      focusOut.textContent = nearestStop(z).name;
    }
    function rackTo(z) {
      // ease focus to a depth stop, like pulling focus on a lens
      cancelAnimationFrame(tween);
      const from = bg.focus, start = performance.now(), dur = 900;
      const step = (now) => {
        const p = Math.min(1, (now - start) / dur);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        bg.setFocus(from + (z - from) * e);
        if (p < 1) tween = requestAnimationFrame(step);
      };
      tween = requestAnimationFrame(step);
    }
    function buildTicks() {
      ticks.textContent = '';
      // merge stops that sit almost on top of each other
      const stops = [];
      bg.stops().forEach((s) => {
        const prev = stops[stops.length - 1];
        if (prev && s.z - prev.z < 0.025) prev.name += ' + ' + s.name;
        else stops.push({ name: s.name, z: s.z });
      });
      stops.forEach((s) => {
        ticks.appendChild(el('button', {
          class: 'ab-tick', style: 'left:' + (s.z * 100).toFixed(2) + '%', title: 'Focus on ' + s.name, tabindex: '-1',
          onclick: () => rackTo(s.z),
        }));
      });
    }
    focus.addEventListener('input', () => { cancelAnimationFrame(tween); bg.setFocus(+focus.value); });

    // --- sliders --------------------------------------------------------------
    function slider(label, min, max, step, value, fmt, onInput) {
      const id = 'ab-' + label;
      const input = el('input', { type: 'range', min, max, step, id, 'aria-label': label });
      const out = el('output', { for: id });
      const set = (v) => { input.value = v; out.textContent = fmt(+v); input.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(2) + '%'); };
      input.addEventListener('input', () => { set(input.value); onInput(+input.value); });
      set(value);
      return { row: el('label', { class: 'ab-row', for: id }, [el('span', { text: label }), input, out]), set };
    }
    const o = bg.options;
    const blur = slider('blur', 0, 2, 0.05, o.blur, (v) => v.toFixed(2), (v) => bg.setBlur(v));
    const speed = slider('speed', 0, 3, 0.05, o.speed, (v) => v.toFixed(2) + '×', (v) => bg.setSpeed(v));

    // --- toggles --------------------------------------------------------------
    function toggle(label, checked, onChange) {
      const input = el('input', { type: 'checkbox' });
      input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      return { node: el('label', { class: 'ab-check' }, [input, el('span', { text: label })]), input };
    }
    const rack = toggle('auto rack', o.autoRack, (v) => bg.setAutoRack(v));
    const snap = toggle('grid lock', o.snap, (v) => bg.setSnap(v));
    const ptr = toggle('pointer', o.pointer, (v) => bg.setPointer(v));

    // --- scene switcher -------------------------------------------------------
    const seg = el('div', { class: 'ab-seg', role: 'group', 'aria-label': 'Scene' });
    const segBtns = scenes.map((name) => {
      const b = el('button', { type: 'button', text: NS.scenes[name].title || name, onclick: () => bg.setScene(name) });
      seg.appendChild(b);
      return [name, b];
    });

    // --- panel ----------------------------------------------------------------
    const hideBtn = el('button', { class: 'ab-icon', type: 'button', 'aria-label': 'Hide controls', text: '–', onclick: () => setHidden(true) });
    const panel = el('section', { class: 'ab-panel', 'aria-label': 'Background controls' }, [
      el('header', { class: 'ab-head' }, [el('span', { class: 'ab-title', text: 'ascii depth' })].concat(scenes.length > 1 ? [seg] : [el('span', { class: 'ab-scene', text: NS.scenes[scenes[0]].title })], [hideBtn])),
      el('div', { class: 'ab-row ab-focus' }, [
        el('label', { for: 'ab-focus', text: 'focus' }),
        el('div', { class: 'ab-track' }, [focus, ticks]),
        focusOut,
      ]),
      blur.row,
      speed.row,
      el('div', { class: 'ab-checks' }, [rack.node, snap.node, ptr.node]),
      el('p', { class: 'ab-keys', text: '[ ] focus · click a tick to rack · space pause · h hide' }),
    ]);
    const pill = el('button', { class: 'ab-pill', type: 'button', text: '◐ controls', 'aria-label': 'Show controls', onclick: () => setHidden(false) });
    function setHidden(h) {
      panel.hidden = h; pill.hidden = !h;
      store('ab-hidden', h ? '1' : '0');
      (h ? pill : focus).focus({ preventScroll: true });
    }
    document.body.appendChild(panel);
    document.body.appendChild(pill);
    // start collapsed on small screens so the panel doesn't sit on the scene
    const saved = store('ab-hidden');
    panel.hidden = saved != null ? saved === '1' : g.innerWidth < 640;
    pill.hidden = !panel.hidden;

    // --- engine -> ui -----------------------------------------------------------
    bg.on('focus', showFocus);
    bg.on('autorack', (v) => { rack.input.checked = v; });
    bg.on('scene', ({ name }) => {
      segBtns.forEach(([n, b]) => b.setAttribute('aria-pressed', String(n === name)));
      buildTicks();
      showFocus(bg.focus);
      const p = new URLSearchParams(location.search);
      p.set('scene', name);
      history.replaceState(null, '', '?' + p.toString());
    });
    segBtns.forEach(([n, b]) => b.setAttribute('aria-pressed', String(n === bg.scene)));
    buildTicks();
    showFocus(bg.focus);

    // --- keyboard ----------------------------------------------------------------
    g.addEventListener('keydown', (e) => {
      if (e.target.matches && e.target.matches('input[type="text"], textarea')) return;
      if (e.key === '[' || e.key === ']') {
        cancelAnimationFrame(tween);
        bg.setFocus(bg.focus + (e.key === ']' ? 0.02 : -0.02));
      } else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        bg.paused ? bg.play() : bg.pause();
      } else if (e.key === 'h' || e.key === 'H') {
        setHidden(!panel.hidden);
      } else if (/^[1-9]$/.test(e.key) && scenes[+e.key - 1]) {
        bg.setScene(scenes[+e.key - 1]);
      }
    });
  };
})(window);
