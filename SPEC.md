# jsontree — spec

A static JSON viewer and formatter, servable from GitHub Pages and shippable as a
Chrome extension. Vanilla HTML/CSS/JS: no build step, no framework, no external
assets, no network at runtime.

The product goal is that it reads as a **native macOS utility** rather than a web
page — one window, no modal screens, a search field in the toolbar, and chrome
that never changes size as you work.

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
  #content-wrap  the tree, the empty state, or the source editor
  #statusbar     24px, fixed
```

The toolbar and status bar are the same height in every state. Searching,
entering the editor and emptying the document all leave them untouched, and
nothing between them moves — the window never flinches.

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

Left to right: wordmark · mode switch · actions · spacer · search field ·
appearance switch. The actions are flat macOS toolbar buttons, 12.5px, rounded
hover fill.

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
- **In the source editor**: `Format` `Minify`

`Copy` and `Copy Path` are a pair: both act on the selected row, one taking
its value and the other its path. `Copy` puts the whole of the selected node
on the clipboard as pretty-printed JSON — an array comes out as an array with
everything in it, whether or not it is expanded, and a leaf as its value, a
string in its quotes. With nothing selected, or the root, that is the whole
document. The status bar says which it was: `Copied value` or
`Copied document`.

The editor has no Copy or Paste button. It is a text field, and the keyboard
does both there. `Format` and `Minify` act on the editor's text, so they exist
nowhere else.

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
  part of it, so it sits beside the label, not in it, and search does not look at
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
the `⌘F Search` hint until the reader picks a node.

### Search

One field, always in the toolbar, at the right: a 230px pill holding a
magnifier, the input, a count (`2/5`), previous and next chevrons, and a clear
button that appears once something is typed. It is there in both views and
searches whichever is showing. ⌘F puts the caret in it.

- **Over the tree** it finds rows. A row matches when its label — the key, or
  `key : value` — holds the query. Every matching row is tinted; the current
  one is selected, which expands its ancestors and scrolls it into view. The
  count is of rows.
- **In the source editor** it finds text. Every occurrence is marked, the
  current one more strongly, and the editor scrolls to it — down and across —
  unless it is already in view. The count is of occurrences, so the same
  query can count differently in the two views. Invalid JSON is searched like
  any other text.

Common to both:

- Incremental and case-insensitive; the query is trimmed. Each keystroke
  searches afresh and goes to the first match.
- Return, ⌘G and the down chevron go to the next match; Shift-Return, ⇧⌘G and
  the up chevron to the previous. Both wrap. The chevrons leave the caret in
  the field.
- While a query stands, the status bar's left side reads
  `Valid JSON · 2 of 5 matches for “city” · 1.3 KB`, or `No matches for …`.
- The query stands when the view changes, and is run again in the new one.
  Editing the text under a standing query updates the marks and the count and
  keeps the current match's place in the list rather than starting over.
- Escape in the field clears it and hands the keyboard back: to the tree,
  with the last match still selected, or to the editor, with the caret on the
  last match and that match selected. The view does not move. Escape anywhere
  else clears a standing query and moves nothing. The clear button empties the
  field and keeps the caret in it.

The marks in the editor are a third copy of the text under the other two, with
nothing showing but the ground behind each match, and like them it is only
drawn for the lines on screen.

On text too long to colour (see the editor, below) there is no copy to mark,
so only the current match is shown, as a box. Its position is found by
hit-testing the textarea (`document.caretPositionFromPoint`) rather than by
measuring a copy of the line: on a line hundreds of thousands of characters
long that changes font thousands of times, a copy laid out elsewhere lands
tens of pixels from where the textarea has the text. Editing the text removes
the box until the next step. Where the browser cannot hit-test a textarea, the
editor scrolls to roughly the right place and draws no box.

In a window 800px wide or less there is no room for the field beside the
actions. It folds down to its magnifier and opens across the toolbar, over the
actions, for as long as it has focus. Folded, it takes the accent fill while a
query stands. Above 900px it widens to 270px on focus.

### Status bar

One line, 24px, always present.

- **Left**: `Valid JSON · 1.3 KB · 56 nodes`, or `Empty`, or a transient
  confirmation (`Copied path`), or an error in `--danger`. In the editor it
  counts lines rather than nodes. While a search stands, its tally takes the
  place of that count; an error still outranks it.
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
  what shows. The two must agree on every metric that places a glyph — as
  must the third copy that search puts under them for its marks.
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
clipboard. An invalid buffer is left as it is and the error reported.

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

### Appearance switch

The last thing in the toolbar, past the search field — so the field can widen
on focus without moving it — is an icon button that goes between light and
dark by setting `data-theme`. Like the mode switch it shows where it leads: a
moon in light, a sun in dark. It is there in every view and at every width.

- With nothing chosen the app follows the system.
- Choosing what the system would show anyway is choosing to follow it again:
  the attribute is dropped rather than kept, so one press never pins the app
  for good.
- The website remembers the choice in `localStorage` (`jsontree-theme`), and a
  line in the page's `<head>` applies it before anything is drawn, so a reload
  never shows the other appearance first. Nothing else is ever stored.
- The extension does not remember it. In a page it took over, `localStorage`
  belongs to the site that served the document, and the extension keeps
  nothing of its own (`PRIVACY.md`). There the choice lasts for the page.

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
connector columns, paths, arrow navigation), search over the tree (tinting,
counting, revealing, stepping, clearing) and in the editor (marking every
occurrence, marks lying exactly under their text, scrolling to a match,
following edits, handing the caret back, standing across the view change,
invalid JSON, the boxed match on a line too long to colour) and the field
folding in a narrow window, the toolbar (which actions show in
which view, each of them against the document and the clipboard, that Copy
takes the selected node whole, and that Format and Minify leave the clipboard
alone), the editor (round-trip, pasting with the keyboard, refusing
to close while invalid, line numbers, colouring by type, the coloured copy
lying exactly over the textarea, escaping, the fault underline, drawing the
right lines wherever a long document is scrolled to, and the plain fallback),
error positions including truncated input, the theme override in both
directions, and the appearance switch (both ways, remembered across a reload,
and dropped when it agrees with the system).
`tests/extension.spec.js` drives the real extension in a browser.

## Non-goals

No URL loading, no ads, no analytics, no external requests at runtime, no
frameworks, no virtualisation for very large documents.
