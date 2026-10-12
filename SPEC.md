# jsontree — spec

A static JSON viewer and formatter, servable from GitHub Pages and shippable as a
Chrome extension. Vanilla HTML/CSS/JS: no build step, no framework, no external
assets, no network at runtime.

The product goal is that it reads as a **native macOS utility** rather than a web
page — one window, no modal screens, a summoned find bar, and chrome that never
changes size as you work.

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
```

The toolbar and status bar are the same height in every state. Opening the find
bar, entering the editor and emptying the document all leave them untouched —
the window never flinches.

### Opening

What the app opens on depends on whether it has a document:

- **Empty** — how the website always starts — it opens in the source editor
  with the caret in the textarea, so the first thing a visitor can do is paste.
- **Handed a document** — how the extension starts it — it goes straight to the
  tree. The editor is never shown on the way.

The empty state (`No document`) is no longer where the app starts. It is what
leaving the editor with nothing in it shows — which is also how a document is
cleared: empty the source, then `View`.

### Toolbar

Left to right: wordmark · mode switch · actions · spacer · find icon. The
actions are flat macOS toolbar buttons, 12.5px, rounded hover fill. The find
icon takes an accent fill while the find bar is open.

The mode switch is the one button that moves between the tree and the source
editor. It sits directly beside the wordmark, ahead of the actions, because it
decides what the rest of the toolbar holds, and it is always drawn as a raised
button so it reads as a different kind of control from them.

- It names the view it leads to, not the one showing: `Edit` with a pencil
  over the tree, `View` with a tree glyph in the editor.
- It never takes the accent fill. Accent means "this is open" in this toolbar,
  and a highlighted `View` would say the opposite of the truth.
- It is the same width with either label, so the actions beside it do not
  shift when it is pressed.

The actions depend on what the content area is showing, and only one set is
ever visible:

- **Over the tree** (including the empty state): `Copy` `Copy Path` ·
  `Expand All` `Collapse All`
- **In the source editor**: `Copy` `Paste` · `Format` `Minify`

`Copy` is first in both and does not move when the set changes. It copies the
whole document — pretty-printed over the tree, exactly as typed in the editor.
`Paste`, `Format` and `Minify` act on the editor's text, so they exist nowhere
else.

Every action is a toolbar button. There is no command palette or menu behind
them, so an action with no button in the current view does not exist there.

### Tree

An 18px indent column grid, faint 1px indent guides (never elbows), CSS
disclosure triangles, a type icon on every row, and an inset rounded
source-list selection in the system accent.

- Root is labelled `JSON` and starts expanded; deeper levels start collapsed.
- Container rows show the key; leaf rows show `key : value`, strings quoted.
- Every row starts with an icon for its type — a glyph in that type's colour:
  `{}` object, `[]` array, `“` string, `#` number, `∅` null, and for a boolean
  its value, `✓` true or `✕` false. On the selected row it turns white with
  the label.
- A container row ends with a count of what it holds, in the tertiary text
  colour: `6 keys` for an object, `0 items` for an array, singular for exactly
  one. The root counts too. The count describes the document rather than being
  part of it, so it sits beside the label, not in it, and find does not search
  it.
- Array children are keyed by index.
- Every row carries `data-path` — `results[1].author.orcid` — which the status
  bar displays and Copy Path copies. A key is written with a dot
  only when it cannot be mistaken for anything else; otherwise it is
  bracket-quoted, so the key `a.b` is `["a.b"]` and stays distinct from a
  nested `a` → `b`. Paths are therefore unique across the document. The root's
  path is empty, shown as `(root)`; copying it is refused rather than silently
  putting an empty string on the clipboard.
- Expand/collapse animates over 250ms. A toggle arriving mid-animation is
  ignored rather than queued.

Hovering a row previews its path in the status bar; leaving restores the
selected row's path. Selection always wins over the preview — moving by
keyboard fires no `mouseleave`, so without that the bar would keep showing
whatever the pointer happened to be resting on. Copy Path copies the selected
row, falling back to the hovered one only when nothing is selected. Nothing is selected on load, so the status bar can show
the `⌘F Find` hint until the reader picks a node.

### Find bar

⌘F opens it; it is not permanent chrome. It searches tree labels, so it
refuses to open over the source editor or an empty document and says why —
otherwise it would report matches and a path for rows nobody can see, and take
the caret out of the textarea. Incremental: every keystroke
re-searches node labels, wraps each hit in `mark.find-match`, and reports
`N of M`. Moving to a match expands its ancestors, selects the row and scrolls
it into view. ⌘G / ⇧⌘G and the chevrons cycle with wraparound. Escape or `Done`
closes and removes every highlight, restoring label text exactly.

### Status bar

One line, 24px, always present.

- **Left**: `Valid JSON · 1.3 KB · 56 nodes`, or `Empty`, or a transient
  confirmation (`Copied path`), or an error in `--danger`. In the editor it
  counts lines rather than nodes.
- **Right**: the selected or hovered path, click to copy; otherwise the
  keyboard hint.

### Source editor

`Edit` swaps the tree for the source — monospaced, 12.5px on a 20px line, with
a gutter of line numbers beside it — and `View`, the same button, swaps back.

The text is in colour. Values take the colour of their type, from the same
tokens as the tree's icons: strings, numbers, booleans and null. Keys and
punctuation stay in the default ink.

- The colouring comes from a lexer, not the parser, so it colours whatever is
  there. One typo costs one line its colour, not everything after it.
- The text is drawn twice. The textarea takes the typing, the caret and the
  selection, but its own glyphs are transparent; a coloured copy behind it is
  what shows. The two must agree on every metric that places a glyph.
- Only the lines on screen are drawn, plus a margin above and below — numbers
  and colour alike — and they are redrawn as the editor scrolls. Drawing
  therefore costs the same in a 2 MB document as in a small one, where
  redrawing the whole document on each keystroke measured about 130ms at
  290 KB. This relies on JSON tokens never crossing a line break.
- More than 100,000 characters on screen at once — in practice one enormous
  line, such as a large minified document — is not coloured: the textarea
  shows its own text, plain. The line numbers stay.
- The gutter is 46px, which holds four digits, and widens with the number of
  lines beyond that.
Validation runs on every keystroke. Leaving the editor requires JSON that
parses — otherwise the error stands and the editor stays open, rather than
silently discarding the edit. Opening it puts the caret at the top.

`Format` re-indents the text with two spaces and `Minify` strips its
whitespace. Both rewrite the textarea and nothing else: neither touches the
clipboard, so getting minified JSON out is `Minify`, then `Copy`. `Paste`
replaces the whole text with the clipboard. An invalid buffer is left as it is
and the error reported.

### Errors

No modal dialogs anywhere. Invalid JSON is reported in the status bar as
`Invalid JSON — line 3, column 3: expected "," or "}"`. In the editor the
offending line's number turns red and bold with a dot beside it, and the text
from the fault to the end of that line takes a wavy red underline.

`JSON.parse` is the parser, but it is not a reliable source of *position*: the
common truncated-input case raises `Unexpected end of JSON input`, which carries
no position at all, so a message-scraping implementation reports line 1 for a
fault anywhere in the document. `locateJsonError()` therefore re-walks the text
with its own scanner whenever parsing failed, and is engine-independent.

That scanner has to be exactly as strict as `JSON.parse`, not merely close to
it. Anything it accepts that the engine rejects — a leading zero, a bare `-`, a
trailing decimal point, an empty exponent, an unknown `\x` escape, a short
`\u`, a raw control character in a string — leaves it finding nothing wrong,
and the position is lost. Where it genuinely cannot place the fault it reads the
engine's own `(line N column M)` or `at position N` rather than assuming line 1.

For input that simply ran out, the reported column is one past the last
character — the position where the input ended, not the character before it.

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
page it took over. The document is shown as the tree, and the app leaves the
editor to show it — it boots into the editor, so this call is what gets the
extension to the tree. Unparseable input opens the editor with the text and the
error, rather than leaving a blank window.

## Testing (Playwright)

`npm test` builds the extension, starts a static server and runs headless
chromium. `tests/app.spec.js` covers the shell (opening in the editor when
empty and on the tree when handed a document, the empty state, constant chrome
heights), the tree (labels, type icons, container counts, expand/collapse,
connector columns, paths, arrow navigation), find (highlighting, counting, revealing, cycling, cleanup), the
toolbar (which actions show in
which view, each of them against the document and the clipboard, and that
Format and Minify leave the clipboard alone), the editor (round-trip, refusing
to close while invalid, line numbers, colouring by type, the coloured copy
lying exactly over the textarea, escaping, the fault underline, drawing the
right lines wherever a long document is scrolled to, and the plain fallback),
error positions including truncated input, and the theme override in both
directions.
`tests/extension.spec.js` drives the real extension in a browser.

## Non-goals

No URL loading, no ads, no analytics, no external requests at runtime, no
frameworks, no virtualisation for very large documents.
