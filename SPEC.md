# jsontree — spec

A from-scratch static reimplementation of the classic "Online JSON Viewer" (jsonviewer.stack.hu) look and feel, servable from GitHub Pages. Vanilla HTML/CSS/JS, no build step, no external assets, no copied code — the visual style is recreated by hand to look like the classic Ext JS 2.x "gray" theme.

## Files

- `index.html`, `css/style.css`, `js/app.js` at repo root (Pages serves root)
- `.nojekyll`, `README.md` (one-step Pages deploy instructions)
- `package.json` + `tests/` with Playwright e2e tests (dev-only; the site itself has zero dependencies)

## Overall layout

- App fills the entire viewport (the original had ad bands top/bottom — omitted).
- Page background `#ededed`. Base UI font: `11px tahoma, arial, helvetica, sans-serif`.
- One tab panel with two tabs: **Viewer** and **Text**. **Text is active on page load.**

### Tab strip (classic Ext 2 gray look, recreate by eye)

- Strip height ~25px, background `#eaeaea` with a subtle bottom-lightening vertical gradient, bottom border `1px solid #d0d0d0`.
- Tabs: rounded top corners (~3px), 1px `#d0d0d0` border, bold 11px text `#333`.
- Inactive tab: light gray gradient (`#f5f5f5` → `#e5e5e5`), sits 1px lower.
- Active tab: near-white gradient (`#ffffff` → `#f1f1f1`), joins seamlessly with content below (no bottom border).
- Hover on inactive tab: slightly lighter.

## Text tab

Top toolbar + full-size textarea + thin status bar at bottom.

### Toolbar

- Height ~26px, vertical gradient `#f9f9f9` → `#e3e7e8` (Ext gray toolbar look), bottom border `1px solid #d0d0d0`, 2px padding.
- Flat text buttons, 11px tahoma `#444`, padding ~3px 6px. Hover: 1px `#b9d0ef`-style border + very light blue background (`#eff5fb`) — classic Ext toolbar button hover. Pressed: slightly darker.
- Buttons left-to-right: `Paste` `Copy` | `Format` `Remove white space` | `Clear` — with thin 1px vertical separator lines (`#d0d0d0`, ~16px tall) between the groups.
- Right-aligned: `About`.
- (The original also had "Load JSON data" — intentionally omitted.)

### Textarea

- Fills remaining space, no resize handle, monospace font (`12px Monaco, Menlo, "Courier New", monospace`), white background, no border except panel border `1px solid #d0d0d0` around content area.
- Placeholder text (gray): `Paste the JSON code here (your code is not saved anywhere)` — use the native `placeholder` attribute.

### Status bar

- ~20px high strip below the textarea, background `#ededed` top-border `#d0d0d0`. Empty by default. Left side may show transient status text (e.g. "Copied to clipboard").

### Button behaviors

- **Paste**: `navigator.clipboard.readText()` → replaces textarea content. On failure (permission denied/unsupported) show the Ext-style error dialog: title `Error`, message `Clipboard access denied. Press Ctrl+V / Cmd+V to paste.`
- **Copy**: writes textarea content to clipboard (`navigator.clipboard.writeText`, fallback `document.execCommand('copy')`). Show "Copied" in status bar for ~2s.
- **Format**: parse textarea as JSON. Valid → replace content with `JSON.stringify(parsed, null, 2)` (2-space indent, key order preserved). Invalid → error dialog (below), content unchanged.
- **Remove white space**: parse, then `JSON.stringify(parsed)` (minified). Invalid → error dialog.
- **Clear**: empty the textarea (no confirmation).
- **About**: modal Ext-style dialog, title `About`, body: app name "jsontree", one line "A JSON viewer and formatter." and a line "Runs entirely in your browser — nothing you paste is sent anywhere." OK button closes. Also closable via title-bar X and Escape.

## Viewer tab

Activating the Viewer tab parses the textarea:

- Invalid JSON → modal error dialog **and stay on the Text tab** (tab does not switch).
- Empty/whitespace-only → show an empty tree (just no nodes; no root) and empty grid; no error.
- Valid → build tree.

Layout: tree panel (center, white background) + vertical splitter + property grid panel on the right (default ~270px wide). The splitter is a 5px draggable bar (background `#ededed`); dragging resizes the grid panel (min 120px, max 60% of window). Below the tree panel: search toolbar. All panels bordered `1px solid #d0d0d0`.

### Tree

- Root node labelled `JSON` with the object icon, expanded by default; its immediate children visible; deeper levels collapsed.
- Row height ~18px, font 11px tahoma, black text. Indent ~18px per level.
- Faint dotted connector lines (1px dotted `#c0c0c0` vertical lines through the indent columns, classic Ext tree "lines" look).
- Expander for container nodes: 9×9px box with 1px gray border, white background, centered `+` (collapsed) or `−` (expanded). Draw with CSS/inline SVG. Leaves have no expander (blank 16px slot).
- Type icons (16×16 slot, draw with inline SVG or CSS, do NOT copy images):
  - **object**: navy-blue `{}` curly braces glyph (bold, like the original)
  - **array**: navy-blue `[]` square brackets glyph
  - **string**: small navy-blue filled square (~9px)
  - **number**: small green filled square
  - **boolean**: small yellow filled square
  - **null**: small red filled square
- Labels:
  - container: just the key name (e.g. `address`, `tags`); root is `JSON`
  - leaf: `key : value` — strings render with double quotes (`name : "John"`), numbers/booleans/null render bare (`age : 30`, `active : true`, `score : null`)
  - array children use their index as key (`0 : "a"`)
- Click a row → select it: full-width light-blue highlight (`#dfe8f6`) and update grid. Click expander (or double-click a container row) → toggle expand.
- Keyboard: not required.

### Property grid (right panel)

- Two columns: `Name` (~55% width) and `Value`. Header: ~22px, gray gradient like toolbar, 1px `#d0d0d0` borders between cells, 11px `#333` text, bold not required.
- Clicking a header sorts by that column; toggle asc/desc; show a small sort arrow (▲/▼ style, drawn) next to the active column label. Default: sorted by Name ascending.
- Rows: ~19px, white background, 1px light row separator (`#ededed`), 11px tahoma.
- Content: the properties of the **selected container node** (object/array). If a **leaf** is selected, show the properties of its parent container. Values: strings quoted (`"John"`), numbers/booleans/null literal, objects/arrays shown as `...`.
- On load (root selected implicitly): show root's properties.

### Search toolbar (bottom of tree panel)

- Same toolbar styling. Contents: label `Search:`, text input (~150px, classic sunken 1px border), button `GO!`, thin separator, button `Next` with a small green down-arrow icon, button `Previous` with a small green up-arrow icon (draw arrows with CSS/SVG).
- GO!: case-insensitive substring search over node labels (keys and stringified leaf values). Collect matches in document order; jump to first match: expand all ancestors, select it, scroll into view.
- Next / Previous: cycle through the match list (wrap around). Enter key in the input = GO!.
- No matches: brief status/no-op (no dialog).

## Modal dialogs (Ext-style, recreate by eye)

- Page dimmed by a mask (`rgba(200,200,200,0.5)`).
- Window: ~260–320px wide, centered, 1px `#a0a0a0` border, ~4px rounded corners, drop shadow, background `#f0f0f0`.
- Title bar: ~22px, gray gradient, bold 11px `#333` text left, small X close button right.
- Body: 16px padding; error dialogs show a red circular X icon (~32px, drawn with CSS/SVG) left of the message text.
- Footer: centered `OK` button (classic beveled gray button, ~75px wide). OK, X, and Escape all close.
- JSON error dialog: title `JSON error`, message `Invalid JSON variable`.

## State sync

- Single source of truth: the textarea text. Viewer rebuilds from it every time the Viewer tab is activated (tree/grid/search state reset). Switching back to Text changes nothing.

## Testing (Playwright)

`package.json` with `@playwright/test` devDependency; `npm test` starts a static server (use Playwright `webServer` with `npx http-server` or `python3 -m http.server` equivalent — prefer a node static server) and runs tests headless in chromium. Cover at least:

1. Loads with Text tab active, placeholder visible.
2. Format: minified input → 2-space-indented output; key order preserved.
3. Remove white space: pretty input → minified.
4. Clear empties textarea.
5. Invalid JSON + Format → error dialog appears with "Invalid JSON variable"; OK dismisses.
6. Invalid JSON + click Viewer tab → dialog, stays on Text tab.
7. Valid nested JSON → Viewer shows root `JSON`, first-level children, correct labels/quoting for string/number/boolean/null leaves.
8. Expand/collapse via expander works; deeper level hidden until expanded.
9. Selecting an object node updates grid rows (names & values, `...` for containers).
10. Selecting a leaf shows parent's properties in grid.
11. Grid header click sorts asc/desc.
12. Search finds a deep key (e.g. `lat`), expands ancestors, selects node; Next cycles to following match; Previous goes back; wraps around.
13. Copy button: grant clipboard permissions, assert clipboard content equals textarea.
14. About dialog opens and closes.
15. Empty textarea + Viewer tab → no error, empty tree.

## Non-goals

- No URL loading, no ads, no analytics, no external requests at runtime, no frameworks.
