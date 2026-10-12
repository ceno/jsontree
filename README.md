# jsontree

A static JSON viewer and formatter that behaves like a native macOS utility.
Runs entirely in the browser; nothing you paste is sent anywhere.

## Features

- Interactive tree viewer with expand/collapse and full keyboard navigation
- Find bar on ⌘F — incremental, with a match count, revealing matches buried
  in collapsed subtrees
- Command palette on ⌘K with fuzzy filtering
- A status bar that always shows validity, size and the selected node's path
  (`results[1].author.orcid`), click to copy
- Source editor with precise line/column error reporting — no modal dialogs
- Format, Minify, Copy, Paste and Clear
- Light and dark, following the system appearance

## Keyboard

| | |
|---|---|
| `⌘F` | Find · `⌘G` / `⇧⌘G` next and previous · `Esc` closes |
| `⌘K` | Command palette |
| `↑` `↓` | Move through the tree |
| `←` `→` | Collapse / expand, or step out and in |
| `⌘⌥←` `⌘⌥→` | Collapse all / expand all |
| `⌘⌥C` | Copy the selected node's path |

## Run locally

```bash
npx http-server -p 8080 -c-1
```

Then open http://localhost:8080 in your browser.

`-c-1` turns off caching. Without it `http-server` sends an hour of
`max-age`, and a tab you leave open keeps running the build it first loaded —
a reload will not pick up your edits.

## Chrome extension

Renders any JSON page in jsontree instead of raw text. Point Finder at Chrome as
well and double-clicking a `.json` file opens it in the viewer too.

Grab a prebuilt zip from [Releases](https://github.com/ceno/jsontree/releases)
and unzip it — its `jsontree/` folder is ready to load, so skip to step 2 — or
build it from this checkout:

1. `npm run build:extension` — copies the app into `extension/vendor/`, which is
   what the extension actually loads (a content script cannot reach outside the
   extension directory).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick the `extension/` folder.
3. A tab opens asking for site access — click **Enable on all sites**, then
   **Allow**. Nothing renders until you do; see below for why.
4. For local files: click **Details** on the extension and turn on **Allow
   access to file URLs**.
5. For Finder: **Get Info** on any `.json` file → **Open with** → Google
   Chrome → **Change All**.

Rebuild after editing `index.html`, `css/style.css` or `js/app.js` — `npm test`
does it for you.

### Why it asks for access

The viewer can only tell a JSON document from an ordinary page by reading
`document.contentType`, which means running on the page first — and JSON is
served from any origin, so no match pattern can narrow that down in advance.
Declaring `<all_urls>` in the manifest would say exactly that, but it also costs
an in-depth Chrome Web Store review measured in weeks. So the access is optional
instead: the manifest asks for nothing, `grant.html` requests `*://*/*` at
runtime, and `background.js` registers the content scripts once you agree. The
grant persists, so it is one click per machine.

Local files are the exception. Chrome will not grant `file:///*` through
`permissions.request()`, so that one scheme stays in the manifest as a static
content script — which is why it needs the **Allow access to file URLs** toggle
rather than the grant. It does not trigger the broad-host-permission review.

It takes over documents served as `application/json`, `*/*+json`, `text/json`,
and `text/plain` when the URL ends in `.json`. It backs off and leaves the raw
text alone if the body does not parse as JSON or is larger than 10 MB. JSON sent
as a download (`Content-Disposition: attachment`) never renders as a page, so
the extension never sees it.

## Run tests

```bash
npm install
npx playwright install chromium
npm test
```

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**, choose `main` branch and `/` (root) folder.
4. Click **Save**. GitHub Pages will serve `index.html` from the repo root.

The `.nojekyll` file ensures GitHub Pages does not apply Jekyll processing.
