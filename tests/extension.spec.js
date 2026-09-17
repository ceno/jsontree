// @ts-check
// Drives the real extension: Chromium is launched with extension/ loaded, then
// pointed at a URL that serves JSON.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { test, expect, chromium } = require('@playwright/test');

const EXT = path.join(__dirname, '..', 'extension');
const JSON_URL = 'http://localhost:8080/tests/fixtures/sample.json';

/** @type {import('@playwright/test').BrowserContext} */
let context;
let profileDir;
let cspServer;

// API responses often carry a strict CSP. The viewer pulls its stylesheet from
// the extension, so this checks that the page's CSP does not block it.
const CSP_PORT = 8099;
const CSP_URL = `http://localhost:${CSP_PORT}/data.json`;

test.beforeAll(async () => {
  cspServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.end(JSON.stringify({ city: 'Springfield', tags: ['admin'] }));
  });
  await new Promise((resolve) => cspServer.listen(CSP_PORT, resolve));

  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsontree-ext-'));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => cspServer.close(resolve));
  fs.rmSync(profileDir, { recursive: true, force: true });
});

test('renders a JSON URL in the tree viewer', async () => {
  const page = await context.newPage();
  await page.goto(JSON_URL);

  // Viewer tab is showing, with the parsed tree in it.
  await expect(page.locator('#tab-viewer')).toHaveClass(/active/);
  await expect(page.locator('#tree-container .tree-row').first()).toBeVisible();
  await expect(page.locator('#tree-container')).toContainText('address');
  await expect(page.locator('#tree-container')).toContainText('"Springfield"');

  // Text tab holds the document, pretty-printed.
  const raw = await page.locator('#json-input').inputValue();
  expect(JSON.parse(raw).address.city).toBe('Springfield');
  expect(raw).toContain('\n  "name": "John"');

  // No leftovers from the raw document.
  await expect(page.locator('pre')).toHaveCount(0);

  // The extension's stylesheet loaded (the app is unreadable without it).
  await expect(page.locator('#tab-strip')).toHaveCSS('display', 'flex');
  await page.close();
});

test('renders JSON served with a strict CSP', async () => {
  const page = await context.newPage();
  await page.goto(CSP_URL);

  await expect(page.locator('#tree-container')).toContainText('"Springfield"');
  await expect(page.locator('#tab-strip')).toHaveCSS('display', 'flex');
  await page.close();
});

test('leaves ordinary pages alone', async () => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/');

  // The app itself is an ordinary page: it must boot normally, on the Text tab.
  await expect(page.locator('#tab-text')).toHaveClass(/active/);
  await expect(page.locator('#json-input')).toHaveValue('');
  await page.close();
});

test('leaves malformed JSON as raw text', async () => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/tests/fixtures/broken.json');

  await expect(page.locator('pre')).toHaveCount(1);
  await expect(page.locator('#app')).toHaveCount(0);
  await expect(page.locator('html')).toBeVisible();
  await page.close();
});
