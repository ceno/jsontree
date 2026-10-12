# jsontree — spec

A static JSON viewer and formatter, servable from GitHub Pages and shippable as a
Chrome extension. Vanilla HTML/CSS/JS: no build step, no framework, no external
assets, no network at runtime.

The product goal is that it reads as a **native macOS utility** rather than a web
page — one window, no modal screens, a summoned find bar, a command palette, and
chrome that never changes size as you work.

## Files

- `index.html`, `css/style.css`, `js/app.js` at repo root (Pages serves root)
- `.nojekyll`, `README.md`, `PRIVACY.md`
- `extension/` — the Chrome extension; `scripts/build-extension.js` copies the
  app into `extension/vendor/`
- `package.json` + `tests/` with Playwright e2e tests (dev-only)

## Shape

```
#app
  #toolbar       38px, fixed
  #findbar       0px closed, 34px open
  #content-wrap  the tree, the empty state, or the source editor
  #statusbar     24px, fixed
#palette-overlay
```

The toolbar and status bar are the same height in every state. Opening the find
bar, entering the editor and emptying the document all leave them untouched —
the window never flinches.

### Toolbar

Left to right: wordmark · `Paste` `Copy` · `Format` `Minify` · spacer ·
`Edit` · find icon · palette icon. Flat macOS toolbar buttons, 12.5px, rounded
hover fill. The find and palette icons take an accent fill while their surface
is open.

### Tree

Unchanged from the previous release and deliberately so: an 18px indent column
grid, faint 1px indent guides (never elbows), CSS disclosure triangles, type
icons (`{}` `[]` and coloured dots for string/number/boolean/null), and an
inset rounded source-list selection in the system accent.

- Root is labelled `JSON` and starts expanded; deeper levels start collapsed.
- Container rows show the key; leaf rows show `key : value`, strings quoted.
- Array children are keyed by index.
- Every row carries `data-path` — `results[1].author.orcid` — which the status
  bar displays and the Copy Path command copies.
- Expand/collapse animates over 250ms. A toggle arriving mid-animation is
  ignored rather than queued.

Hovering a row previews its path in the status bar; leaving restores the
selected row's path. Nothing is selected on load, so the status bar can show
the `⌘K Commands · ⌘F Find` hint until the reader picks a node.

### Find bar

⌘F opens it; it is not permanent chrome. Incremental: every keystroke
re-searches node labels, wraps each hit in `mark.find-match`, and reports
`N of M`. Moving to a match expands its ancestors, selects the row and scrolls
it into view. ⌘G / ⇧⌘G and the chevrons cycle with wraparound. Escape or `Done`
closes and removes every highlight, restoring label text exactly.

### Command palette

⌘K opens a centred, blurred sheet with a fuzzy subsequence filter scored so
earlier, tighter runs rank first. Commands: Format, Minify, Copy All, Copy
Selection, Copy Path, Paste, Clear, Edit Source, Find, Expand All, Collapse All,
About jsontree. Arrow keys move, Enter runs, Escape closes.

The four most-used actions are also plain toolbar buttons — the palette is the
power path, not the only path.

### Status bar

One line, 24px, always present.

- **Left**: `Valid JSON · 1.3 KB · 56 nodes`, or `Empty`, or a transient
  confirmation (`Copied path`), or an error in `--danger`. In the editor it
  counts lines rather than nodes.
- **Right**: the selected or hovered path, click to copy; otherwise the
  keyboard hint.

### Source editor

`Edit` swaps the tree for a monospaced textarea plus a 16px marker gutter.
Validation runs on every keystroke. Leaving the editor requires JSON that
parses — otherwise the error stands and the editor stays open, rather than
silently discarding the edit. Opening it puts the caret at the top.

### Errors

No modal dialogs anywhere. Invalid JSON is reported in the status bar as
`Invalid JSON — line 3, column 3: expected "," or "}"`, with a red dot in the
editor gutter on the offending line.

`JSON.parse` is the parser, but it is not a reliable source of *position*: the
common truncated-input case raises `Unexpected end of JSON input`, which carries
no position at all, so a message-scraping implementation reports line 1 for a
fault anywhere in the document. `locateJsonError()` therefore re-walks the text
with its own scanner whenever parsing failed, and is engine-independent.

## Theming

One token set on bare `:root` carries the complete light palette. Dark is
applied twice — under `prefers-color-scheme` guarded by
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]` —
so a host page can force either appearance via `documentElement.dataset.theme`
regardless of the OS setting. That matters for the extension, which renders
inside pages whose appearance we do not control.

No component rule may contain a literal colour. A colour defined only inside a
media query renders one theme's text on the other theme's ground.

## External API

`window.jsontree.load(text)` renders a document; the extension calls it with the
page it took over. Unparseable input opens the editor with the text and the
error, rather than leaving a blank window.

## Testing (Playwright)

`npm test` builds the extension, starts a static server and runs headless
chromium. `tests/app.spec.js` covers the shell (empty state, constant chrome
heights), the tree (labels, expand/collapse, connector columns, paths, arrow
navigation), find (highlighting, counting, revealing, cycling, cleanup), the
palette (fuzzy filter, running a command), the toolbar actions against the
clipboard, the editor (round-trip, refusing to close while invalid), error
positions including truncated input, and the theme override in both directions.
`tests/extension.spec.js` drives the real extension in a browser.

## Non-goals

No URL loading, no ads, no analytics, no external requests at runtime, no
frameworks, no virtualisation for very large documents.
