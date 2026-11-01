# background-ascii-test

An ASCII landscape background for mrrobertstuart.com, in two colours: paper and ink. Every layer moves at its own speed and has its own focus blur, so flat text reads with real depth. No dependencies, no build step.

Two scenes:

- **Vista** (default): a giant knitted sun with hatched rays, a jagged Coast Mountains range with snow left as bare paper, valley haze, a pointed fir treeline and a dense forest of strokes that slides faster the closer it is. The left of the sky is kept clear for the header.

  The walk follows a looping route: fir forest → a clearing with a log cabin (notched corners, paned windows, chimney smoke, woodpile) → forest → a lake that mirrors the treeline and mountains, with someone fishing off a dock → forest → a winding river with someone floating down it on an inner tube. Lakes and rivers sit on the ground plane, so they widen toward you in perspective as they pass. It opens on the lake.

  Vista uses small 8px type (7px on phones) for detail; shapes are designed at 12px and scaled, so they keep their size while getting more characters.
- **BC**: a side-scroller in "ruled" ASCII (horizontal rules broken into runs and sprinkled with `─ • = □ ■ 0–9`): mountains, foothills, stands of Douglas firs and log cabins with chimney smoke passing by over a ruled ground strip.

`index.html` shows the header (name, title, View work) over the scene.

## Run it

Open `index.html` in a browser. It works straight from disk (plain scripts, no modules), or serve the folder with anything (`npx serve`, GitHub Pages, etc.).

- `index.html` – the header over the scene, with a small control panel
- `example.html` – the same scene used as a quiet background behind page content

## Controls

| | |
|---|---|
| **focus** | where the lens is focused, from the horizon (left) to the lens (right). Click a tick under the slider to rack focus to that layer. |
| **blur** | depth-of-field strength. `0` = everything sharp. |
| **speed** | travel speed. |
| **auto rack** | slowly sweeps focus near ↔ far. |
| **grid lock** | snaps every layer to one shared character grid, so motion steps column by column like a real terminal. |

Keys: `[` `]` move focus · `space` pause · `h` hide the panel.

### URL parameters

`?focus=0.6&blur=1.5&speed=0.5&snap=1&rack=1&start=40&ui=0`

`start` skips ahead that many seconds of travel; `ui=0` hides the panel; `debug=1` exposes per-layer render timings on `bg.stats`.

## Use it as a background

```html
<div id="bg" style="position:fixed; inset:0"></div>

<script src="src/noise.js"></script>
<script src="src/engine.js"></script>
<script src="src/scenes/vista.js"></script>
<script>
  const bg = AsciiBG.create(document.getElementById('bg'), { speed: 0.6 });
  // bg.setFocus(0.3), bg.setBlur(0), bg.pause(), bg.play(), bg.destroy() ...
</script>
```

Options: `scene`, `focus`, `blur`, `speed`, `snap`, `pointer` (mouse parallax, off by default), `autoRack`, `start`, `fontSize`, `fontWeight`, `bg`, `ink`, `fps`, `maxDpr`. The two colours are `bg` (paper, `#ecebe7`) and `ink` (`#1c1b19`); pass your own pair to recolour the whole scene.

It respects `prefers-reduced-motion` (slows right down) and skips frames when nothing has changed. Layers that don't animate are drawn once into an off-screen strip and slid into place; ground rows are cached as strips and only redrawn when they move a whole column or their animation ticks (12 fps). It drops to 1× resolution on devices that can't hold ~40 fps.

## How it works

Each layer is drawn onto its own stacked `<canvas>`:

1. **Parallax** – a layer at depth `z` scrolls at `z × speed`. The mountains barely move; the ground is split into bands where every row has its own depth, so it slides like a floor.
2. **Occlusion** – each layer paints a silhouette in the background colour under its characters, so nearer things hide farther things. Farther layers get a slightly lighter fill (atmospheric perspective).
3. **Depth of field** – each canvas gets a CSS `blur()` and its characters dim based on the distance between its `z` and the focus depth.
4. **Two colours** – one paper colour and one ink. Tone comes from which characters are used and how densely; distance from how faint they are.

Characters are stamped from a pre-rendered glyph atlas (one column per glyph, one row per ink colour) at any opacity, so one cell can stack a solid block and a stroke. Ridgelines pick characters by slope and sub-row position (`_ - ' / \`) so they read as smooth lines instead of staircases.

## Make your own scene

A scene is a list of layers, back to front. A layer gives its top edge per column and a character per cell:

```js
AsciiBG.scenes.myscene = {
  title: 'My scene',
  focus: 0.3,
  glyphs: "─-·.,:'^_|/\\",            // every character the scene uses
  layers: [
    {
      name: 'hills', z: 0.2, occlude: true, static: true,
      span(col, S, t, out) {          // top + bottom row for this world column
        out[0] = S.rows * (0.5 - 0.1 * AsciiBG.noise.fbm1(col * 0.01, 1));
        out[1] = S.rows + 2;
        return true;
      },
      glyph(col, row, d, t, put) {    // d = rows below the top edge
        if (d < 1) return put('-', 0.6);
        if (col % 2 === 0 && row % 2 === 0) put('·', 0.25);
      },
    },
  ],
};
```

See `src/scenes/vista.js` and `src/scenes/bc.js` for everything else (band layers, merged canvases, reflections, free-moving birds via `custom`) and the header of `src/engine.js` for the full layer reference.

## Files

```
index.html          demo + control panel
example.html        used as a page background
styles.css          panel styles
src/noise.js        seeded hash / value noise / fbm / ridged noise
src/engine.js       renderer: layers, parallax, occlusion, depth of field
src/scenes/vista.js the Vista scene (default)
src/scenes/bc.js    the BC side-scroller
src/ui.js           control panel
```
