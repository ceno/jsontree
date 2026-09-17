# jsontree

A static JSON viewer and formatter — a clean-room recreation of the classic "Online JSON Viewer" look and feel. Runs entirely in the browser; nothing you paste is sent anywhere.

## Features

- Format and minify JSON
- Interactive tree viewer with expand/collapse
- Property grid with sortable columns
- Keyword search with Next/Previous navigation
- Paste/Copy clipboard support
- Classic Ext JS 2.x gray theme

## Run locally

```bash
npx http-server -p 8080
```

Then open http://localhost:8080 in your browser.

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
3. For local files: click **Details** on the extension and turn on **Allow
   access to file URLs**.
4. For Finder: **Get Info** on any `.json` file → **Open with** → Google
   Chrome → **Change All**.

Rebuild after editing `index.html`, `css/style.css` or `js/app.js` — `npm test`
does it for you.

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
