// @ts-check
// Drives the real extension: Chromium is launched with extension/ loaded, then
// pointed at a URL that serves JSON.
//
// The shipped extension asks for host access at runtime rather than declaring
// it (see extension/background.js), and the grant is a native dialog Playwright
// cannot click. So the tests run against a copy of extension/ whose manifest
// declares the same origins as host_permissions: loading unpacked grants those
// outright, which puts the browser in exactly the state a real grant produces —
// chrome.permissions.getAll() reports them, and background.js registers the
// content scripts off the back of that. The un-granted state gets its own
// context, and its own test, below.
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
let grantedExt;
let cspServer;

/** A copy of extension/ with the optional host access already granted. */
function buildGrantedCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsontree-granted-'));
  fs.cpSync(EXT, dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

async function launch(extDir, dirPrefix) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), dirPrefix));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
    ],
  });
  return { ctx, profile };
}

// Registration happens in the service worker, asynchronously, so a navigation
// can otherwise beat it to the page.
async function waitForRegistration(ctx, expected) {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  await expect
    .poll(
      async () =>
        (await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts()))
          .length,
      { timeout: 10000 }
    )
    .toBe(expected);
  return sw;
}

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

  grantedExt = buildGrantedCopy();
  const launched = await launch(grantedExt, 'jsontree-ext-');
  context = launched.ctx;
  profileDir = launched.profile;
  await waitForRegistration(context, 1);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => cspServer.close(resolve));
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.rmSync(grantedExt, { recursive: true, force: true });
});

test('renders a JSON URL in the tree viewer', async () => {
  const page = await context.newPage();
  await page.goto(JSON_URL);

  // The document renders as the tree, with no interaction needed — the app
  // opens in the editor when it has nothing to show, but not here.
  await expect(page.locator('#tree-container .tree-row').first()).toBeVisible();
  await expect(page.locator('#app')).not.toHaveClass(/editing/);
  await expect(page.locator('#edit-area')).toBeHidden();
  await expect(page.locator('#btn-edit')).toHaveText('Edit');
  await expect(page.locator('#tree-container')).toContainText('address');
  await expect(page.locator('.tree-row[data-path="address"]')).toBeVisible();

  // The status bar describes the document it just rendered.
  await expect(page.locator('#status-left')).toContainText('Valid JSON');

  // The source is there, pretty-printed, behind the Edit button.
  await page.locator('#btn-edit').click();
  const raw = await page.locator('#edit-area').inputValue();
  expect(JSON.parse(raw).address.city).toBe('Springfield');
  expect(raw).toContain('\n  "name": "John"');

  // The editor is numbered and coloured here too, inside someone else's page.
  await expect(page.locator('#edit-line-numbers')).toContainText('1');
  await expect(page.locator('#edit-highlight .tok-str', { hasText: '"Springfield"' })).toBeVisible();

  // Search works in both views, on a page whose keys the extension shares.
  await page.locator('#search-input').fill('springfield');
  await expect(page.locator('#edit-marks mark.current')).toHaveText('Springfield');
  await page.locator('#btn-edit').click();
  await expect(page.locator('.tree-row.search-match')).toHaveAttribute('data-path', 'address.city');
  await expect(page.locator('#search-count')).toHaveText('1/1');

  // No leftovers from the raw document.
  await expect(page.locator('pre')).toHaveCount(0);

  // The extension's stylesheet loaded (the app is unreadable without it).
  await expect(page.locator('#toolbar')).toHaveCSS('display', 'flex');
  await page.close();
});

test('renders JSON served with a strict CSP', async () => {
  const page = await context.newPage();
  await page.goto(CSP_URL);

  await expect(page.locator('#tree-container')).toContainText('"Springfield"');
  await expect(page.locator('#toolbar')).toHaveCSS('display', 'flex');
  await page.close();
});

test('leaves ordinary pages alone', async () => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/');

  // The app itself is an ordinary page: it must boot normally — empty, and
  // so in the editor.
  await expect(page.locator('#app')).toHaveClass(/empty/);
  await expect(page.locator('#app')).toHaveClass(/editing/);
  await expect(page.locator('#edit-area')).toBeVisible();
  await page.close();
});

// The state the extension actually ships in: no host access, so nothing runs.
// This is what keeps <all_urls> out of the manifest and off the review.
test('does nothing until host access is granted', async () => {
  const { ctx, profile } = await launch(EXT, 'jsontree-ungranted-');
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));

    // Onboarding: a fresh install opens the grant page rather than looking broken.
    await expect
      .poll(() => ctx.pages().map((p) => p.url()).join(' '), { timeout: 10000 })
      .toContain('grant.html');

    const page = await ctx.newPage();
    await page.goto(JSON_URL);

    await expect(page.locator('pre')).toHaveCount(1);
    await expect(page.locator('#app')).toHaveCount(0);
    expect(
      await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())
    ).toHaveLength(0);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('leaves malformed JSON as raw text', async () => {
  const page = await context.newPage();
  await page.goto('http://localhost:8080/tests/fixtures/broken.json');

  await expect(page.locator('pre')).toHaveCount(1);
  await expect(page.locator('#app')).toHaveCount(0);
  await expect(page.locator('html')).toBeVisible();
  await page.close();
});
