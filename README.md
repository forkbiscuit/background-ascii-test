# background-ascii-test

Daytime in the Canadian Rockies, drawn entirely in ASCII: jagged peaks with glaciers and tilted rock strata, sun and drifting cumulus, foothills, spruce forest, a glacial lake that mirrors the peaks, a few birds, and a rock pile right in front of the lens. Every layer moves at its own speed and has its own focus blur, so the flat text reads with real depth.

Full daytime colour: a blue sky with sun glow, white snow on blue-grey rock, green spruce, a turquoise glacial lake whose reflections pick up the real colours above it. Everything is still drawn with characters. No dependencies, no build step.

## Run it

Open `index.html` in a browser. It works straight from disk (plain scripts, no modules), or serve the folder with anything (`npx serve`, GitHub Pages, etc.).

- `index.html` – the scene with a small control panel
- `example.html` – the same scene used as a quiet background behind page content

## Controls

| | |
|---|---|
| **focus** | where the lens is focused, from the horizon (left) to the lens (right). Click a tick under the slider to rack focus to that layer. |
| **blur** | depth-of-field strength. `0` = everything sharp. |
| **speed** | travel speed. |
| **auto rack** | slowly sweeps focus near ↔ far. |
| **grid lock** | snaps every layer to one shared character grid, so motion steps column by column like a real terminal. |
| **pointer** | layers shift with the mouse for a little extra parallax. |

Keys: `[` `]` move focus · `space` pause · `h` hide the panel.

### URL parameters

`?focus=0.6&blur=1.5&speed=0.5&snap=1&pointer=0&rack=1&start=40&ui=0`

`start` skips ahead that many seconds of travel; `ui=0` hides the panel; `debug=1` exposes per-layer render timings on `bg.stats`.

## Use it as a background

```html
<div id="bg" style="position:fixed; inset:0"></div>

<script src="src/noise.js"></script>
<script src="src/engine.js"></script>
<script src="src/scenes/rockies.js"></script>
<script>
  const bg = AsciiBG.create(document.getElementById('bg'), { speed: 0.6 });
  // bg.setFocus(0.3), bg.setBlur(0), bg.pause(), bg.play(), bg.destroy() ...
</script>
```

Options: `scene`, `focus`, `blur`, `speed`, `snap`, `pointer`, `autoRack`, `start`, `fontSize`, `bg`, `ink`, `fps`, `maxDpr`. Colours live in the scene: `background` (any CSS background, the sky here), `inks` (named character colours) and each layer's `fill`.

It respects `prefers-reduced-motion` (slows right down), skips frames when nothing has changed, only redraws a layer once it has moved by a whole pixel, and drops to 1× resolution on devices that can't hold ~40 fps.

## How it works

Each layer is drawn onto its own stacked `<canvas>`:

1. **Parallax** – a layer at depth `z` scrolls at `z × speed`. The sky and sun are fixed; the range barely moves; the lake is split into bands where every row has its own depth, so the water slides like a floor.
2. **Occlusion** – each layer paints a silhouette in the background colour under its characters, so nearer things hide farther things. Farther layers get a slightly lighter fill (atmospheric perspective).
3. **Depth of field** – each canvas gets a CSS `blur()` and its characters dim based on the distance between its `z` and the focus depth.
4. **Reflections** – each lake cell looks up what sits above the waterline at its mirrored position (stretched 1.6× so the peaks land in the water), then ripple noise breaks it into streaks.
5. **Light** – the sun is upper left, so faces that rise to the right are lit and faces that fall away are in shadow. Rock gets tilted strata bands; snow and glaciers follow the fall line.

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

See `src/scenes/rockies.js` for everything else (band layers, merged canvases, reflections, free-moving birds via `custom`) and the header of `src/engine.js` for the full layer reference.

## Files

```
index.html          demo + control panel
example.html        used as a page background
styles.css          panel styles
src/noise.js        seeded hash / value noise / fbm / ridged noise
src/engine.js       renderer: layers, parallax, occlusion, depth of field
src/scenes/rockies.js  the Rockies scene
src/ui.js           control panel
```
