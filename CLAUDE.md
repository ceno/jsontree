# jsontree

A static, zero-dependency JSON viewer and formatter that is meant to read as a
native macOS utility rather than a web page: one window with a unified toolbar,
a search field in it that works over the tree and in the source editor, a
single content area holding the tree / empty state / source editor, and one
status bar whose height never changes between states. It is vanilla HTML/CSS/JS with no build step and
no framework — `index.html`, `css/style.css` and `js/app.js` at the repo root
are the whole app, served straight from GitHub Pages. The same three files are
also copied into `extension/vendor/` to ship as a Chrome extension that takes
over any `application/json` page. Nothing is ever sent anywhere: all parsing
happens in the browser. **`SPEC.md` is the behavioural contract — read it before
changing behaviour, and update it when behaviour changes.**

## Commands

```bash
npm install                      # once
npx playwright install chromium  # once

npm test                         # build the extension, then run all 76 tests
npm run build:extension          # copy the app into extension/vendor/

npx http-server . -p 8080 -c-1   # serve locally at http://localhost:8080
```

Narrower test runs:

```bash
npx playwright test tests/app.spec.js            # app only (fast)
npx playwright test tests/extension.spec.js      # the real extension in Chrome
npx playwright test -g "search"                  # by test name
npx playwright test --reporter=line              # quieter output
```

## Things that will bite you

- **`-c-1` is not optional when serving by hand.** `http-server` defaults to an
  hour of `max-age`, so a browser tab keeps running whatever build it first
  loaded and a reload will not pick up your edits. This has already produced one
  false "the fix doesn't work".
- **Rebuild the extension after touching `index.html`, `css/style.css` or
  `js/app.js`.** `extension/vendor/` is a generated copy and is gitignored;
  `npm test` rebuilds it for you, a bare `npx playwright test` does not.
- **The tests address tree rows by `data-path`** (`.tree-row[data-path="a.b"]`),
  not by text. Paths bracket-quote any key that isn't a plain identifier, so the
  key `a.b` is `["a.b"]` and stays distinct from a nested `a` → `b`.
- **Expand/collapse is animated and mid-animation toggles are dropped on
  purpose.** A test that clicks an expander twice in a row must wait for the
  first to land — use the `toggle()` helper in `tests/app.spec.js`.
- **The app opens in the source editor when it has no document.** Straight
  after `page.goto('/')` the mode switch reads `View`, and clicking it *leaves*
  the editor. Use the `type()` helper in `tests/app.spec.js`, which only presses
  it when the tree is showing. `window.jsontree.load()` is what moves to the
  tree — it is how the extension, and the tests' `load()` helper, get there.
- **What you read in the editor is not the textarea.** Its own glyphs are
  transparent; `#edit-highlight` behind it is the coloured copy that shows, and
  only the lines on screen are drawn. So anything that sets `editArea.value`
  must call `refreshEditor()` afterwards or the page keeps showing the old
  text, and the two elements must share every metric that places a glyph — one
  CSS rule holds them, and `EDIT_LINE_HEIGHT` in `js/app.js` tracks its
  line-height. `#edit-highlight` is deliberately not a `<pre>`: the extension
  tells a raw JSON page by its `<pre>`. Search adds a third copy under both,
  `#edit-marks`, bound by the same rule — so a `<mark>` in it must never get
  padding or a border, which would push the text after it out of line.
- **Don't trust `JSON.parse`'s message for an error position.** Truncated input
  raises `Unexpected end of JSON input` with no position at all. `locateJsonError()`
  in `js/app.js` re-walks the text itself and must stay exactly as strict as the
  engine; anything it accepts that `JSON.parse` rejects silently loses the position.
- **Every colour must be a token defined on bare `:root`.** A colour whose only
  definition sits inside a media query renders one theme's text on the other
  theme's ground. Dark is declared twice, under `prefers-color-scheme` and under
  `[data-theme="dark"]`, so a host page can force either appearance.
