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
