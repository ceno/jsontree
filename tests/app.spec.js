// @ts-check
const { test, expect } = require('@playwright/test');

const SAMPLE = JSON.stringify({
  name: 'John',
  age: 30,
  active: true,
  score: null,
  address: {
    street: '123 Main St',
    city: 'Springfield',
    geo: { lat: 37.3861, lng: -122.0839 }
  },
  tags: ['admin', 'user']
});

/** Load a document the way the extension does, then wait for the tree. The
 *  app opens in the editor; being handed a document is what leaves it. */
async function load(page, text = SAMPLE) {
  await page.goto('/');
  await page.evaluate((t) => window.jsontree.load(t), text);
  await expect(page.locator('#tree-container .tree-row').first()).toBeVisible();
}

/** Toggle a container by its path, then wait for the slide to finish.
 *  Mid-animation toggles are deliberately ignored by the app, so a test that
 *  clicks twice in a row has to let the first one land. */
async function toggle(page, path) {
  await page.locator(`.tree-row[data-path="${path}"] .expander-box`).click();
  await page.waitForFunction((p) => {
    const row = document.querySelector(`.tree-row[data-path="${p}"]`);
    const children = row && row.parentElement.querySelector(':scope > .tree-children');
    return children && children.style.height === '';
  }, path);
}
const expand = toggle;

/** Put text into the source editor and let it validate. An empty app is
 *  already in the editor, where the same button would leave it. */
async function type(page, text) {
  if (!(await page.locator('#edit-area').isVisible())) await page.locator('#btn-edit').click();
  await page.locator('#edit-area').fill(text);
}

// ----------------------------------------------------------------
// Shell
// ----------------------------------------------------------------
test('1. opens empty in the source editor, ready for a paste', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveClass(/editing/);
  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(page.locator('#edit-area')).toBeFocused();
  await expect(page.locator('#edit-area')).toHaveValue('');
  await expect(page.locator('#btn-edit')).toHaveText('View');
  await expect(page.locator('#empty-state')).toBeHidden();
  await expect(page.locator('#tree-container .tree-row')).toHaveCount(0);
  await expect(page.locator('#status-left')).toHaveText('Empty · 0 B · 0 lines');
  await expect(page.locator('#status-left')).not.toHaveClass(/error/);
  await expect(page.locator('#status-path')).toHaveText('⌘F Search');
});

// What the extension does: the app boots empty, in the editor, and is then
// handed a document — which has to land on the tree, not behind the editor.
test('1b. a document handed to the app goes straight to the tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveClass(/editing/);
  await page.evaluate((t) => window.jsontree.load(t), SAMPLE);

  await expect(page.locator('#app')).not.toHaveClass(/editing/);
  await expect(page.locator('.tree-row[data-path="address"]')).toBeVisible();
  await expect(page.locator('#edit-area')).toBeHidden();
  await expect(page.locator('#btn-edit')).toHaveText('Edit');
  await expect(page.locator('#status-left')).toContainText('Valid JSON');
  await expect(page.locator('#status-left')).toContainText('nodes');   // the tree's readout, not the editor's

  // The keyboard belongs to the tree, not to the textarea it just left.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row.selected .tree-label')).toHaveText('JSON');
});

// Leaving the editor with nothing in it is still allowed, and is the one way
// to reach the empty state now that the app no longer opens on it.
test('1c. View on an empty editor shows the empty state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-edit').click();
  await expect(page.locator('#app')).toHaveClass(/empty/);
  await expect(page.locator('#app')).not.toHaveClass(/editing/);
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#status-left')).toHaveText('Empty');
});

test('2. the status bar is the same height in every state', async ({ page }) => {
  await load(page);
  const bar = page.locator('#statusbar');
  const resting = (await bar.boundingBox()).height;
  const content = (await page.locator('#content-wrap').boundingBox()).y;

  // Searching happens in the toolbar: it opens nothing, so nothing moves.
  await page.keyboard.press('Meta+f');
  await page.keyboard.type('name');
  await expect(page.locator('#search-count')).toHaveText('1/1');
  expect((await bar.boundingBox()).height).toBe(resting);
  expect((await page.locator('#content-wrap').boundingBox()).y).toBe(content);

  await page.keyboard.press('Escape');
  await page.locator('#btn-edit').click();
  await expect(page.locator('#edit-area')).toBeVisible();
  expect((await bar.boundingBox()).height).toBe(resting);

  // The toolbar must not move either.
  await expect(page.locator('#toolbar')).toHaveCSS('height', '38px');
});

// ----------------------------------------------------------------
// Tree
// ----------------------------------------------------------------
test('3. builds the tree with the expected labels and quoting', async ({ page }) => {
  await load(page);
  const labels = page.locator('#tree-container .tree-label');
  await expect(labels.nth(0)).toHaveText('JSON');
  await expect(labels.nth(1)).toHaveText('name : "John"');
  await expect(labels.nth(2)).toHaveText('age : 30');
  await expect(labels.nth(3)).toHaveText('active : true');
  await expect(labels.nth(4)).toHaveText('score : null');
  await expect(labels.nth(5)).toHaveText('address');
});

test('4. expander toggles a subtree', async ({ page }) => {
  await load(page);
  const city = page.locator('.tree-row[data-path="address.city"]');
  await expect(city).toBeHidden();

  await expand(page, 'address');
  await expect(city).toBeVisible();
  await expect(city).toContainText('city : "Springfield"');

  await toggle(page, 'address');
  await expect(city).toBeHidden();
});

// A document long enough to scroll, ending in a container: sixty leaves, a
// closed container among them, and `last` at the very end.
const LONG = JSON.stringify(Object.assign(
  { early: { a: 1, b: 2, c: 3 } },
  Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['k' + i, i])),
  { last: { a: 1, b: 2, c: 3 } }
));
const treeScrollTo = (page, y) =>
  page.locator('#tree-scroll').evaluate((el, y) => { el.scrollTop = y; }, y);
const rowTop = async (page, path) =>
  (await page.locator(`.tree-row[data-path="${path}"]`).boundingBox()).y;
/** The path of the row lying under a point, as the pointer would find it. */
const rowAt = (page, x, y) => page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  const row = el && el.closest('.tree-row');
  return row && row.dataset.path;
}, [x, y]);

// Closing a container at the end of the document used to pull every row
// down, and opening it again to push them back up: either way the pointer was
// left on some other row than the one it had pressed.
test('4b. a row stays under the pointer when it is closed and opened at the end of the document', async ({ page }) => {
  await load(page, LONG);
  await expand(page, 'last');
  await treeScrollTo(page, 1e6);

  const arrow = await page.locator('.tree-row[data-path="last"] .expander-box').boundingBox();
  const x = arrow.x + arrow.width / 2;
  const y = arrow.y + arrow.height / 2;
  const settled = () => page.waitForFunction(() => {
    const children = document.querySelector('.tree-row[data-path="last"]')
      .parentElement.querySelector(':scope > .tree-children');
    return children.style.height === '';
  });

  // The pointer is put down once and never moved again.
  await page.mouse.click(x, y);
  await settled();
  await expect(page.locator('.tree-row[data-path="last.a"]')).toBeHidden();
  expect(await rowAt(page, x, y)).toBe('last');

  await page.mouse.click(x, y);
  await settled();
  await expect(page.locator('.tree-row[data-path="last.a"]')).toBeVisible();
  expect(await rowAt(page, x, y)).toBe('last');
  expect((await page.locator('.tree-row[data-path="last"] .expander-box').boundingBox()).y).toBe(arrow.y);
});

// A window growing taller over the end of the document pulls the scroll
// position back as well, and the browser's scroll anchoring used to answer
// the next opening by scrolling the tree to make that good.
test('4b2. a row opened after the window has grown stays where it is', async ({ page }) => {
  await load(page, LONG);
  await treeScrollTo(page, 1e6);
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: size.height + 100 });

  const before = await rowTop(page, 'last');
  await expand(page, 'last');
  expect(await rowTop(page, 'last')).toBe(before);
});

test('4c. the blank left by closing a container is gone once it is scrolled out of view', async ({ page }) => {
  await load(page, LONG);
  await expand(page, 'last');
  await treeScrollTo(page, 1e6);
  // How far the last row showing ends above the bottom of the tree's window.
  const blank = () => page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#tree-container .tree-row'))
      .filter(r => r.offsetParent !== null);
    return document.getElementById('tree-scroll').getBoundingClientRect().bottom -
           rows[rows.length - 1].getBoundingClientRect().bottom;
  });
  const atEnd = await blank();

  // Three rows went, and nothing came down to take their place.
  await toggle(page, 'last');
  expect(await blank()).toBe(atEnd + 3 * 21);

  // Scrolled away from, the blank is not there to scroll back to. The app
  // hears of a scroll at the next frame, so it is given one.
  await treeScrollTo(page, 0);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await treeScrollTo(page, 1e6);
  expect(await blank()).toBe(atEnd);
});

test('4d. Expand All and Collapse All leave the first row in view where it was', async ({ page }) => {
  await load(page, LONG);
  await treeScrollTo(page, 400);
  const first = await page.evaluate(() => {
    const edge = document.getElementById('tree-scroll').getBoundingClientRect().top;
    return Array.from(document.querySelectorAll('#tree-container .tree-row'))
      .find(r => r.getBoundingClientRect().top >= edge).dataset.path;
  });
  const before = await rowTop(page, first);
  const earlyA = page.locator('.tree-row[data-path="early.a"]');

  // `early` opens above the rows in view, and closes again.
  await page.locator('#btn-expand-all').click();
  await expect(earlyA).toBeVisible();
  expect(await rowTop(page, first)).toBe(before);

  await page.locator('#btn-collapse-all').click();
  await expect(earlyA).toBeHidden();
  expect(await rowTop(page, first)).toBe(before);
});

test('5. connector columns stay in layout at every depth', async ({ page }) => {
  await load(page);
  const rows = page.locator('#tree-container .tree-row');
  // Root: one column, no elbow. Depth 1: two columns, one elbow.
  await expect(rows.nth(0).locator('.tc')).toHaveCount(1);
  await expect(rows.nth(0).locator('.tc-elbow')).toHaveCount(0);
  await expect(rows.nth(1).locator('.tc')).toHaveCount(2);
  await expect(rows.nth(1).locator('.tc-elbow')).toHaveCount(1);
});

test('5b. an indent guide hangs under its own container\'s arrow and crosses no other', async ({ page }) => {
  await load(page);
  await page.locator('#btn-expand-all').click();

  // One guide per open container, drawn by its block of children.
  const guides = await page.evaluate(() => {
    const sides = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; };
    return Array.from(document.querySelectorAll('.tree-children')).map((block) => {
      const style = getComputedStyle(block);
      const box = block.getBoundingClientRect();
      const rows = block.querySelectorAll('.tree-row');
      return {
        drawn: style.backgroundImage !== 'none',
        left: box.left + parseFloat(style.backgroundPositionX),   // the hairline is 1px from here
        top: box.top,
        bottom: box.bottom,
        own: sides(block.parentElement.querySelector(':scope > .tree-row .expander-box')),
        within: Array.from(block.querySelectorAll('.expander-box')).map(sides),
        firstRowTop: rows[0].getBoundingClientRect().top,
        lastRowBottom: rows[rows.length - 1].getBoundingClientRect().bottom,
      };
    });
  });

  expect(guides).toHaveLength(4);   // the root, address, address.geo, tags
  for (const g of guides) {
    expect(g.drawn).toBe(true);
    // Under the middle of its own arrow, and starting below it…
    expect(Math.abs(g.left + 0.5 - (g.own.left + g.own.right) / 2)).toBeLessThanOrEqual(1);
    expect(g.top).toBeGreaterThanOrEqual(g.own.bottom);
    // …in one piece from its first row to its last…
    expect(g.top).toBeCloseTo(g.firstRowTop, 1);
    expect(g.bottom).toBeCloseTo(g.lastRowBottom, 1);
    // …and clear of every arrow further in.
    for (const arrow of g.within) {
      expect(g.left + 1 <= arrow.left || g.left >= arrow.right).toBe(true);
    }
  }

  // No row draws a guide of its own, save the selected one: its fill hides
  // the guides behind it, so it draws that stretch of them itself.
  const lat = page.locator('.tree-row[data-path="address.geo.lat"]');
  const drawn = () => lat.locator('.tc').evaluateAll(
    (cols) => cols.map((c) => getComputedStyle(c).backgroundImage !== 'none'));
  expect(await drawn()).toEqual([false, false, false, false]);
  await lat.click();
  expect(await drawn()).toEqual([true, true, true, false]);
});

test('6. selecting a row shows its path, and the path copies on click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await expand(page, 'address');

  await page.locator('.tree-row[data-path="address.city"]').click();
  await expect(page.locator('#status-path')).toHaveText('address.city');

  await page.locator('#status-path').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('address.city');
});

test('7. array children are addressed with bracket notation', async ({ page }) => {
  await load(page);
  await expand(page, 'tags');
  await page.locator('.tree-row[data-path="tags[0]"]').click();
  await expect(page.locator('#status-path')).toHaveText('tags[0]');
});

test('8. arrow keys walk the tree and expand containers', async ({ page }) => {
  await load(page);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row.selected .tree-label')).toHaveText('JSON');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row.selected .tree-label')).toHaveText('name : "John"');

  // Walk to the collapsed `address` container and open it with ArrowRight.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row.selected .tree-label')).toHaveText('address');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tree-row[data-path="address.city"]')).toBeVisible();
});

// ----------------------------------------------------------------
// Search, over the tree
// ----------------------------------------------------------------
const tinted = (page) => page.locator('.tree-row.search-match').evaluateAll(
  els => els.map(el => el.dataset.path));

test('9. search tints the rows that match, counts them, and reveals buried nodes', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await expect(page.locator('#search-input')).toBeFocused();

  await page.keyboard.type('lat');
  // `lat` is three levels down, inside a collapsed subtree.
  await expect(page.locator('#search-count')).toHaveText('1/1');
  expect(await tinted(page)).toEqual(['address.geo.lat']);
  await expect(page.locator('.tree-row.selected .tree-label')).toHaveText('lat : 37.3861');
  await expect(page.locator('.tree-row.selected')).toBeVisible();
  await expect(page.locator('#status-path')).toHaveText('address.geo.lat');
  await expect(page.locator('#status-left')).toHaveText('Valid JSON · 1 of 1 match for “lat” · 249 B');
});

// A row matches on its key or its value, whatever the case, and every match
// is tinted at once — only the current one is selected.
test('9b. search looks through keys and values alike, ignoring case', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+Alt+ArrowRight');
  await page.locator('#search-input').fill('SPRING');
  expect(await tinted(page)).toEqual(['address.city']);

  await page.locator('#search-input').fill('a');
  const paths = await tinted(page);
  expect(paths).toContain('name');            // the key
  expect(paths).toContain('tags[0]');         // the value, "admin"
  expect(paths).not.toContain('score');
  await expect(page.locator('.tree-row.selected')).toHaveCount(1);
  // The selection outranks the tint on the current match.
  const grounds = await page.evaluate(() => ({
    current: getComputedStyle(document.querySelector('.tree-row.selected')).backgroundColor,
    other: getComputedStyle(document.querySelector('.tree-row.search-match:not(.selected)')).backgroundColor,
    plain: getComputedStyle(document.querySelector('.tree-row[data-path="score"]')).backgroundColor,
  }));
  expect(grounds.other).not.toBe(grounds.plain);
  expect(grounds.other).not.toBe(grounds.current);

  await page.locator('#search-input').fill('no such thing');
  await expect(page.locator('#search-count')).toHaveText('0/0');
  expect(await tinted(page)).toEqual([]);
  await expect(page.locator('#search-next')).toBeDisabled();
  await expect(page.locator('#status-left')).toContainText('No matches for “no such thing”');
});

test('10. search steps through its matches and wraps around', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await page.keyboard.type('a');

  const total = parseInt((await page.locator('#search-count').textContent()).split('/')[1], 10);
  expect(total).toBeGreaterThan(2);
  await expect(page.locator('#search-count')).toHaveText('1/' + total);

  await page.locator('#search-next').click();
  await expect(page.locator('#search-count')).toHaveText('2/' + total);
  // The chevrons leave the caret in the field.
  await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('#search-prev').click();
  await expect(page.locator('#search-count')).toHaveText('1/' + total);
  // Wrap backwards off the first match.
  await page.locator('#search-prev').click();
  await expect(page.locator('#search-count')).toHaveText(total + '/' + total);
  await expect(page.locator('#status-left')).toContainText(total + ' of ' + total + ' matches for “a”');

  // Return and ⌘G go forwards, with Shift backwards.
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-count')).toHaveText('1/' + total);
  await page.keyboard.press('Meta+g');
  await expect(page.locator('#search-count')).toHaveText('2/' + total);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Meta+g');
  await expect(page.locator('#search-count')).toHaveText(total + '/' + total);
  // Each step selects the row it lands on.
  const last = (await tinted(page)).pop();
  await expect(page.locator('.tree-row.selected')).toHaveAttribute('data-path', last);
});

test('11. Escape calls the search off and hands the keyboard back to the tree', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await page.keyboard.type('age');
  expect(await tinted(page)).toEqual(['age']);

  await page.keyboard.press('Escape');
  expect(await tinted(page)).toEqual([]);
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#search-input')).not.toBeFocused();
  await expect(page.locator('#search-count')).toHaveText('');
  await expect(page.locator('#status-left')).toHaveText('Valid JSON · 249 B · 14 nodes');

  // The match it stopped on stays selected, and the arrows move on from it.
  await expect(page.locator('.tree-row.selected')).toHaveAttribute('data-path', 'age');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row.selected')).toHaveAttribute('data-path', 'active');
});

// The cross clears the field but keeps the caret in it, for the next query;
// Escape from outside the field clears a search left standing.
test('11b. the clear button empties the field and keeps the caret in it', async ({ page }) => {
  await load(page);
  await expect(page.locator('#search-clear')).toBeHidden();      // nothing to clear yet
  await page.locator('#search-input').fill('name');
  await page.locator('#search-clear').click();
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#search-input')).toBeFocused();
  expect(await tinted(page)).toEqual([]);

  await page.locator('#search-input').fill('name');
  await page.locator('.tree-row[data-path="age"]').click();      // the query stands
  expect(await tinted(page)).toEqual(['name']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-input')).toHaveValue('');
  expect(await tinted(page)).toEqual([]);
  await expect(page.locator('.tree-row.selected')).toHaveAttribute('data-path', 'age');
});

// ----------------------------------------------------------------
// Toolbar actions
// ----------------------------------------------------------------
test('14. Copy with nothing selected puts the pretty-printed document on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page, '{"b":2,"a":1}');
  await page.locator('#btn-copy').click();
  await expect(page.locator('#status-left')).toHaveText('Copied document');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('{\n  "b": 2,\n  "a": 1\n}');   // key order preserved
});

// Copy used to take the whole document whatever was selected, while Copy Path
// beside it took the selection.
test('14b. Copy takes the selected node, with everything in it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const copy = async (path) => {
    await page.locator(`.tree-row[data-path="${path}"]`).click();
    await page.locator('#btn-copy').click();
    return clipboard();
  };

  // A container still closed comes out whole, and so does one nested in it.
  expect(await copy('tags')).toBe('[\n  "admin",\n  "user"\n]');
  await expect(page.locator('#status-left')).toHaveText('Copied value');
  expect(await copy('address')).toBe(JSON.stringify(JSON.parse(SAMPLE).address, null, 2));

  // A leaf is its value, as JSON.
  expect(await copy('name')).toBe('"John"');
  expect(await copy('age')).toBe('30');
  expect(await copy('score')).toBe('null');
  await expand(page, 'tags');
  expect(await copy('tags[1]')).toBe('"user"');

  // The root is the document.
  expect(await copy('')).toBe(PRETTY);
  await expect(page.locator('#status-left')).toHaveText('Copied document');
});

test('15. Minify rewrites the source in place and leaves the clipboard alone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
  await type(page, '{\n  "name": "John",\n  "age": 30\n}');
  await page.locator('#btn-minify').click();

  await expect(page.locator('#edit-area')).toHaveValue('{"name":"John","age":30}');
  await expect(page.locator('#status-left')).toHaveText('Minified');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('SENTINEL');
});

test('17. emptying the source and leaving the editor returns to the empty state', async ({ page }) => {
  await load(page);
  await type(page, '');
  await page.locator('#btn-edit').click();   // leave the editor

  await expect(page.locator('#app')).toHaveClass(/empty/);
  await expect(page.locator('#tree-container .tree-row')).toHaveCount(0);
  await expect(page.locator('#empty-state')).toBeVisible();
});

// ----------------------------------------------------------------
// Source editor and errors
// ----------------------------------------------------------------
test('18. editing the source rebuilds the tree', async ({ page }) => {
  await load(page);
  await type(page, '{"hello":"world"}');
  await page.locator('#btn-edit').click();   // leave the editor

  await expect(page.locator('#edit-area')).toBeHidden();
  await expect(page.locator('#tree-container .tree-label').nth(1)).toHaveText('hello : "world"');
});

test('18b. leaving the editor keeps open what was open, edited or not', async ({ page }) => {
  await load(page);
  await expand(page, 'address');
  await expand(page, 'address.geo');
  const lat = page.locator('.tree-row[data-path="address.geo.lat"]');
  const tag = page.locator('.tree-row[data-path="tags[0]"]');
  const glyph = (path) => page.locator(`.tree-row[data-path="${path}"] .expander-box`);

  // There and back with nothing changed.
  await page.locator('#btn-edit').click();
  await page.locator('#btn-edit').click();
  await expect(lat).toBeVisible();
  await expect(tag).toBeHidden();          // what was shut stays shut
  await expect(glyph('address')).toHaveClass(/minus/);
  await expect(glyph('tags')).toHaveClass(/plus/);

  // And with the text edited: a value changed inside an open container, and
  // a container added. The first is still open; the new one starts shut.
  const doc = JSON.parse(SAMPLE);
  doc.address.geo.lat = 1;
  doc.extra = { a: 1 };
  await type(page, JSON.stringify(doc));
  await page.locator('#btn-edit').click();
  await expect(lat).toContainText('lat : 1');
  await expect(lat).toBeVisible();
  await expect(tag).toBeHidden();
  await expect(page.locator('.tree-row[data-path="extra"]')).toBeVisible();
  await expect(page.locator('.tree-row[data-path="extra.a"]')).toBeHidden();

  // A root that was shut comes back shut, too.
  await toggle(page, '');
  await page.locator('#btn-edit').click();
  await page.locator('#btn-edit').click();
  await expect(page.locator('.tree-row[data-path=""]')).toBeVisible();
  await expect(page.locator('.tree-row[data-path="name"]')).toBeHidden();
});

test('18c. a first document typed into the empty editor opens at its root only', async ({ page }) => {
  await page.goto('/');
  await type(page, SAMPLE);
  await page.locator('#btn-edit').click();
  await expect(page.locator('.tree-row[data-path="name"]')).toBeVisible();
  await expect(page.locator('.tree-row[data-path="address.city"]')).toBeHidden();
});

test('19. Format re-indents the source in place and leaves the clipboard alone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
  await type(page, '{"b":2,"a":1}');
  await page.locator('#btn-format').click();

  await expect(page.locator('#edit-area')).toHaveValue('{\n  "b": 2,\n  "a": 1\n}');
  await expect(page.locator('#status-left')).toHaveText('Formatted');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('SENTINEL');
});

test('20. invalid JSON reports a real line and column, with no modal', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "a": 1\n  "b": 2\n}');

  await expect(page.locator('#status-left')).toHaveClass(/error/);
  await expect(page.locator('#status-left')).toHaveText('Invalid JSON — line 3, column 3: expected "," or "}"');
  await expect(page.locator('.edit-error-marker')).toHaveCount(1);
  // Nothing modal: the text stays in reach, with the caret still in it.
  await expect(page.locator('dialog, [role="dialog"]')).toHaveCount(0);
  await expect(page.locator('#edit-area')).toBeFocused();
});

// Truncated JSON is the case a message-scraping parser gets wrong: V8 reports
// "Unexpected end of JSON input" with no position at all.
test('21. truncated JSON still reports where the input ran out', async ({ page }) => {
  await page.goto('/');
  await type(page, '[1,2,');
  // Column 6 is one past the last character — the position where the input
  // ran out, not the last character before it.
  await expect(page.locator('#status-left'))
    .toHaveText('Invalid JSON — line 1, column 6: unexpected end of input');
});

// Truncation on a later line must report that line, not be clamped back.
test('21b. end-of-input on a later line reports that line', async ({ page }) => {
  await page.goto('/');
  await type(page, '{"a": 1,\n');
  await expect(page.locator('#status-left'))
    .toHaveText('Invalid JSON — line 2, column 1: unexpected end of input');
});

// These all parse cleanly under a lenient scanner, so the position used to be
// lost and every one of them was reported as line 1 with a raw V8 message.
test('21c. malformed literals report a real position and reason', async ({ page }) => {
  await page.goto('/');
  const cases = [
    ['[01]',        'Invalid JSON — line 1, column 3: numbers may not have a leading zero'],
    ['[1.]',        'Invalid JSON — line 1, column 4: expected a digit after the decimal point'],
    ['[-]',         'Invalid JSON — line 1, column 3: expected a digit'],
    ['[1e]',        'Invalid JSON — line 1, column 4: expected a digit in the exponent'],
    ['["\\x"]',     'Invalid JSON — line 1, column 3: unknown escape "\\x"'],
    ['["\\u12"]',   'Invalid JSON — line 1, column 3: bad \\u escape — four hex digits required'],
  ];
  for (const [input, expected] of cases) {
    await page.locator('#edit-area').fill(input);
    await expect(page.locator('#status-left')).toHaveText(expected);
  }
});

test('21d. the error marker tracks the offending line', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "a": 1,\n  "b": "x",\n  "c": "\\x"\n}');
  await expect(page.locator('#status-left')).toContainText('line 4');
  // It lies over line 4's number and repeats it in red.
  await expect(page.locator('.edit-error-marker')).toHaveText('4');
  const top = await page.locator('.edit-error-marker').evaluate(el => parseFloat(el.style.top));
  expect(top).toBe(54);   // three 18px lines down, not on line 1
});

test('22. the editor refuses to close while the JSON is invalid', async ({ page }) => {
  await load(page);
  await type(page, '{"a":');
  await page.locator('#btn-edit').click();

  await expect(page.locator('#edit-area')).toBeVisible();      // still editing
  await expect(page.locator('#status-left')).toHaveClass(/error/);
});

test('23. empty input is valid, not an error', async ({ page }) => {
  await load(page);
  await type(page, '');
  await expect(page.locator('#status-left')).not.toHaveClass(/error/);
  await page.locator('#btn-edit').click();
  await expect(page.locator('#app')).toHaveClass(/empty/);
});

// ----------------------------------------------------------------
// Appearance
// ----------------------------------------------------------------
test('24. an explicit theme overrides the OS preference in both directions', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await load(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightBg = await bg();

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const forcedDark = await bg();
  expect(forcedDark).not.toBe(lightBg);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  expect(await bg()).toBe(lightBg);
});

test('24b. the appearance switch goes between light and dark, and the choice is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await load(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const forced = () => page.evaluate(() => document.documentElement.dataset.theme || null);
  const saved = () => page.evaluate(() => localStorage.getItem('jsontree-theme'));
  const lightBg = await bg();

  // It shows where it leads: a moon in light, a sun in dark.
  await expect(page.locator('#btn-theme .theme-icon-moon')).toBeVisible();
  await expect(page.locator('#btn-theme .theme-icon-sun')).toBeHidden();

  await page.locator('#btn-theme').click();
  expect(await forced()).toBe('dark');
  const darkBg = await bg();
  expect(darkBg).not.toBe(lightBg);
  await expect(page.locator('#btn-theme .theme-icon-sun')).toBeVisible();
  await expect(page.locator('#btn-theme .theme-icon-moon')).toBeHidden();

  // Still dark after a reload, and from the first frame: the attribute is
  // there before the app's own script has run.
  await page.reload();
  expect(await forced()).toBe('dark');
  expect(await bg()).toBe(darkBg);

  // Back to what the system shows is back to following the system, so
  // nothing is left forced or saved.
  await page.locator('#btn-theme').click();
  expect(await bg()).toBe(lightBg);
  expect(await forced()).toBeNull();
  expect(await saved()).toBeNull();

  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg()).toBe(darkBg);                       // following it
  await page.locator('#btn-theme').click();              // and against it, the other way
  expect(await forced()).toBe('light');
  expect(await saved()).toBe('light');
  expect(await bg()).toBe(lightBg);
});

// ----------------------------------------------------------------
// Regressions found by QA against commit 3660872
// ----------------------------------------------------------------

// D2: restoreStatus() stripped the error class, so a transient expired and
// brought the error text back in neutral grey.
test('27. a transient message does not downgrade a standing error', async ({ page }) => {
  await load(page);
  await type(page, '{"a":');
  await expect(page.locator('#status-left')).toHaveClass(/error/);

  await page.keyboard.press('Meta+Alt+c');          // transient: "No path"
  await expect(page.locator('#status-left')).toHaveText('Invalid JSON — line 1, column 6: unexpected end of input');
  await expect(page.locator('#status-left')).toHaveClass(/error/);
});

// D4: enterEdit() set the caret before the value was assigned, and assigning
// .value resets it to the end.
test('29. loading unparseable text opens the editor at the top', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.jsontree.load('{\n  "a": 1\n  "b": 2\n}'));
  await expect(page.locator('#edit-area')).toBeVisible();
  expect(await page.locator('#edit-area').evaluate(el => el.selectionStart)).toBe(0);
  await expect(page.locator('#status-left')).toContainText('line 3');
});

// D6: an unparseable paste flashed an error over the unchanged document and
// the pasted text was unreachable. Pasting is the keyboard's job, in the
// editor, so the text lands in front of the reader with the error beside it.
test('30. pasting unparseable text keeps it in the editor with the error', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.evaluate(() => navigator.clipboard.writeText('not json at all'));
  await page.locator('#btn-edit').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');

  await expect(page.locator('#edit-area')).toHaveValue('not json at all');
  await expect(page.locator('#edit-highlight')).toHaveText('not json at all');
  await expect(page.locator('#status-left')).toHaveClass(/error/);
});

// D7: the status bar followed the pointer, so arrow navigation left it stale
// and Copy Path copied the hovered row instead of the selected one.
test('31. the path follows the selection, not the pointer', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.locator('.tree-row[data-path="age"]').hover();
  await page.locator('.tree-row[data-path="age"]').click();
  await expect(page.locator('#status-path')).toHaveText('age');

  // Pointer stays on `age` while the selection walks away from it.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#status-path')).toHaveText('active');

  await page.keyboard.press('Meta+Alt+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('active');
});

// D8: the root's path is '', which was copied as an empty string and reported
// as a success.
test('32. copying the root path is refused, not a silent empty copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
  await page.locator('.tree-row').first().click();
  await expect(page.locator('#status-path')).toHaveText('(root)');

  await page.locator('#status-path').click();
  await expect(page.locator('#status-left')).toHaveText('The root has no path');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('SENTINEL');
});

// D8 / QA question 1: keys containing the path notation's own punctuation used
// to produce a path identical to a genuinely nested one.
test('33. awkward keys get unambiguous, unique paths', async ({ page }) => {
  await load(page, '{"":1,"a.b":{"c":2},"a":{"b":{"c":9}},"x[0]":3,"has space":4}');
  await page.keyboard.press('Meta+Alt+ArrowRight');

  const paths = await page.evaluate(() =>
    [...document.querySelectorAll('.tree-row')].map(r => r.dataset.path));
  expect(new Set(paths).size).toBe(paths.length);      // no duplicates
  expect(paths).toContain('[""]');
  expect(paths).toContain('["a.b"].c');
  expect(paths).toContain('a.b.c');
  expect(paths).toContain('["x[0]"]');
  expect(paths).toContain('["has space"]');
});

// D13: Expand/Collapse All reported success on an empty document.
test('34. expand and collapse report honestly on an empty document', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-edit').click();          // out of the editor, onto the empty state
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.keyboard.press('Meta+Alt+ArrowRight');
  await expect(page.locator('#status-left')).toHaveText('Nothing to expand');
  await page.keyboard.press('Meta+Alt+ArrowLeft');
  await expect(page.locator('#status-left')).toHaveText('Nothing to collapse');
});

// D9: the toolbar had no give, so whatever was on the right was pushed off the
// edge of a narrow window.
test('36. the toolbar keeps every control reachable when narrow', async ({ page }) => {
  await load(page);
  // Once over the tree and once in the editor: each brings its own buttons.
  for (const mode of ['tree', 'editor']) {
    if (mode === 'editor') await page.locator('#btn-edit').click();
    for (const width of [1180, 620, 460, 380]) {
      await page.setViewportSize({ width, height: 700 });
      const overflow = await page.locator('#toolbar').evaluate(
        el => el.scrollWidth - el.clientWidth);
      expect(overflow, `toolbar overflows at ${width}px (${mode})`).toBeLessThanOrEqual(0);
      for (const id of ['search-field', 'btn-edit', 'btn-theme']) {
        const box = await page.locator('#' + id).boundingBox();
        expect(box.x + box.width, `${id} off-screen at ${width}px (${mode})`).toBeLessThanOrEqual(width);
      }
      // The buttons may shrink, so fitting is not enough: a squeezed label
      // spills out of its button and into its neighbour.
      const squeezed = await page.locator('#toolbar .tb-btn:visible').evaluateAll(
        els => els.filter(el => el.scrollWidth > el.clientWidth).map(el => el.id));
      expect(squeezed, `labels squeezed at ${width}px (${mode})`).toEqual([]);
    }
  }
});

// QA question 9: the CSS honours reduced motion but the JS slide did not.
test('38. reduced motion skips the expand animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  await page.locator('.tree-row[data-path="address"] .expander-box').click();

  // No inline height is ever parked on the container, and the row is there now.
  await expect(page.locator('.tree-row[data-path="address.city"]')).toBeVisible();
  const h = await page.locator('.tree-row[data-path="address"]').evaluate(
    r => r.parentElement.querySelector(':scope > .tree-children').style.height);
  expect(h).toBe('');
});

// QA question 10: "1 nodes", and KB with no MB above it.
test('39. the status bar counts and units read correctly', async ({ page }) => {
  await load(page, '42');
  await expect(page.locator('#status-left')).toHaveText('Valid JSON · 2 B · 1 node');

  await page.evaluate(() => window.jsontree.load(
    JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) })));
  await expect(page.locator('#status-left')).toContainText(' MB · ');
});

// One button moves between the tree and the editor, and it is the only way
// back out of the editor — so it names the view it leads to.
test('40. the mode switch reads Edit over the tree and View in the editor', async ({ page }) => {
  await load(page);
  const button = page.locator('#btn-edit');
  await expect(button).toHaveText('Edit');
  await expect(button).toHaveAccessibleName('Edit');
  await expect(button).toHaveAttribute('title', 'Edit the source');

  await button.click();
  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(button).toHaveText('View');
  await expect(button).toHaveAccessibleName('View');
  await expect(button).toHaveAttribute('title', 'View the tree');
  // Accent means "this is open" in the toolbar. A button reading View while
  // the editor is showing must not claim that.
  await expect(button).not.toHaveClass(/on/);

  await button.click();
  await expect(page.locator('#edit-area')).toBeHidden();
  await expect(button).toHaveText('Edit');
});

// It sits with the wordmark, ahead of every action, and is the same size
// whichever label it shows — otherwise the actions shuffle sideways.
test('40b. the mode switch sits beside the wordmark and does not change size', async ({ page }) => {
  await load(page);
  const box = (sel) => page.locator(sel).boundingBox();
  const brand = await box('.brand');
  const asEdit = await box('#btn-edit');
  const copy = await box('#btn-copy');

  expect(asEdit.x).toBeGreaterThanOrEqual(brand.x + brand.width);
  expect(asEdit.x - (brand.x + brand.width)).toBeLessThan(12);     // right next to it
  expect(asEdit.x + asEdit.width).toBeLessThanOrEqual(copy.x);

  await page.locator('#btn-edit').click();
  const asView = await box('#btn-edit');
  expect(asView.x).toBe(asEdit.x);
  expect(asView.width).toBe(asEdit.width);
});

// It must not get stuck on "Edit" when the editor refuses to close.
test('41. the mode switch stays on View while the JSON is invalid', async ({ page }) => {
  await load(page);
  await type(page, '{"a":');
  await page.locator('#btn-edit').click();          // refused
  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(page.locator('#btn-edit')).toHaveText('View');

  await page.locator('#edit-area').fill('{"a":1}');
  await page.locator('#btn-edit').click();
  await expect(page.locator('#btn-edit')).toHaveText('Edit');
});

// The same entry point the extension uses must leave the button consistent.
test('42. loading unparseable text leaves the button reading View', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.jsontree.load('{"a":'));
  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(page.locator('#btn-edit')).toHaveText('View');
});

// ----------------------------------------------------------------
// The toolbar's two sets of actions
// ----------------------------------------------------------------
// The mode switch comes first, beside the wordmark; then that view's actions.
const toolbarLabels = async (page) =>
  (await page.locator('#toolbar .tb-btn:visible').allTextContents()).map(t => t.trim());
const TREE_ACTIONS = ['Edit', 'Copy', 'Copy Path', 'Expand All', 'Collapse All'];
const EDITOR_ACTIONS = ['View', 'Format', 'Minify'];

test('44. the toolbar shows the tree\'s actions over the tree and the editor\'s while editing', async ({ page }) => {
  await page.goto('/');
  expect(await toolbarLabels(page)).toEqual(EDITOR_ACTIONS);    // opens in the editor
  // The search field belongs to neither set: it is there in both views.
  await expect(page.locator('#search-field')).toBeVisible();

  await page.evaluate((t) => window.jsontree.load(t), SAMPLE);
  expect(await toolbarLabels(page)).toEqual(TREE_ACTIONS);
  // Each set is two groups at most, so one separator never follows another.
  const separators = () => page.locator('#toolbar .tb-sep:visible').count();
  expect(await separators()).toBe(2);

  await page.locator('#btn-edit').click();
  expect(await toolbarLabels(page)).toEqual(EDITOR_ACTIONS);
  expect(await separators()).toBe(1);
  await expect(page.locator('#toolbar')).toHaveCSS('height', '38px');

  await page.locator('#btn-edit').click();
  expect(await toolbarLabels(page)).toEqual(TREE_ACTIONS);
});

test('45. the Copy Path button copies the selected row\'s path', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.locator('#btn-copy-path').click();
  await expect(page.locator('#status-left')).toHaveText('No path');   // nothing selected yet

  await expand(page, 'address');
  await page.locator('.tree-row[data-path="address.city"]').click();
  await page.locator('#btn-copy-path').click();
  await expect(page.locator('#status-left')).toHaveText('Copied path');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('address.city');
});

test('46. the Expand All and Collapse All buttons open and close the whole tree', async ({ page }) => {
  await load(page);
  const lat = page.locator('.tree-row[data-path="address.geo.lat"]');
  await expect(lat).toBeHidden();

  await page.locator('#btn-expand-all').click();
  await expect(lat).toBeVisible();

  await page.locator('#btn-collapse-all').click();
  await expect(lat).toBeHidden();
  await expect(page.locator('.tree-row[data-path="name"]')).toBeVisible();   // the root stays open
});

// ----------------------------------------------------------------
// Type icons and container counts
// ----------------------------------------------------------------
test('50. every type has its own icon, and a boolean\'s shows its value', async ({ page }) => {
  await load(page, '{"o":{},"a":[],"s":"x","n":1,"t":true,"f":false,"z":null}');
  const icon = (path) => page.locator(`.tree-row[data-path="${path}"] .tree-icon`);
  const glyph = (path) => icon(path).evaluate(el => getComputedStyle(el, '::before').content);

  expect(await glyph('o')).toBe('"{}"');
  expect(await glyph('a')).toBe('"[]"');
  expect(await glyph('s')).toBe('"\u201C"');
  expect(await glyph('n')).toBe('"#"');
  expect(await glyph('t')).toBe('"\u2713"');
  expect(await glyph('f')).toBe('"\u2715"');
  expect(await glyph('z')).toBe('"\u2205"');

  // One colour per type: seven rows, with true and false sharing boolean's.
  const colours = await page.locator('.tree-row:not([data-path=""]) .tree-icon').evaluateAll(
    els => els.map(el => getComputedStyle(el).color));
  expect(colours).toHaveLength(7);
  expect(new Set(colours).size).toBe(6);

  // On the selected row the icon goes white with the label, whatever its type.
  await page.locator('.tree-row[data-path="s"]').click();
  await expect(icon('s')).toHaveCSS('color', 'rgba(255, 255, 255, 0.92)');
});

test('51. container rows say how much they hold', async ({ page }) => {
  await load(page, '{"none":{},"one":{"k":1},"many":{"a":1,"b":2},"empty":[],"single":[1],"list":[1,2,3],"leaf":"x"}');
  const count = (path) => page.locator(`.tree-row[data-path="${path}"] .tree-count`);

  await expect(count('')).toHaveText('7 keys');          // the root counts too
  await expect(count('none')).toHaveText('0 keys');
  await expect(count('one')).toHaveText('1 key');
  await expect(count('many')).toHaveText('2 keys');
  await expect(count('empty')).toHaveText('0 items');
  await expect(count('single')).toHaveText('1 item');
  await expect(count('list')).toHaveText('3 items');
  await expect(count('leaf')).toHaveCount(0);            // only containers

  // The label is still just the key.
  await expect(page.locator('.tree-row[data-path="many"] .tree-label')).toHaveText('many');
});

// The count describes the document, it is not in it: searching for "key" must
// not light up every object, and clearing a search must not take it away.
test('52. search neither matches the counts nor disturbs them', async ({ page }) => {
  await load(page, '{"first":{"a":1},"second":[1,2]}');
  await page.keyboard.press('Meta+f');
  await page.locator('#search-input').fill('key');
  await expect(page.locator('#search-count')).toHaveText('0/0');
  await page.locator('#search-input').fill('item');
  await expect(page.locator('#search-count')).toHaveText('0/0');

  await page.locator('#search-input').fill('first');
  await expect(page.locator('#search-count')).toHaveText('1/1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tree-row[data-path="first"] .tree-label')).toHaveText('first');
  await expect(page.locator('.tree-row[data-path="first"] .tree-count')).toHaveText('1 key');
});

// ----------------------------------------------------------------
// The editor's line numbers and colouring
// ----------------------------------------------------------------
const lineNumbers = (page) =>
  page.locator('#edit-line-numbers').evaluate(el => el.textContent.split('\n'));
const drawnText = (page) => page.locator('#edit-highlight').evaluate(el => el.textContent);

test('53. the editor numbers every line and keeps up as the text changes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  expect(await lineNumbers(page)).toEqual(['1']);          // an empty editor still has a first line

  await type(page, '{\n  "a": 1,\n  "b": 2\n}');
  expect(await lineNumbers(page)).toEqual(['1', '2', '3', '4']);
  await page.locator('#edit-area').fill('{"a":1,"b":[1,2]}');
  expect(await lineNumbers(page)).toEqual(['1']);

  // Format, Minify and a paste rewrite the text without the reader typing,
  // and the numbers and the coloured copy have to follow those too.
  await page.locator('#btn-format').click();
  expect(await lineNumbers(page)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(await drawnText(page)).toBe(await page.locator('#edit-area').inputValue());

  await page.locator('#btn-minify').click();
  expect(await lineNumbers(page)).toEqual(['1']);
  expect(await drawnText(page)).toBe('{"a":1,"b":[1,2]}');

  await page.evaluate(() => navigator.clipboard.writeText('[\n  true\n]'));
  await page.locator('#edit-area').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#edit-area')).toHaveValue('[\n  true\n]');
  expect(await lineNumbers(page)).toEqual(['1', '2', '3']);
  expect(await drawnText(page)).toBe('[\n  true\n]');
});

test('54. values are coloured by type; keys and punctuation are not', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "name": "John",\n  "age": 30,\n  "ok": true,\n  "off": false,\n  "none": null,\n  "neg": -1.5e3\n}');
  const texts = (cls) => page.locator('#edit-highlight .' + cls).allTextContents();

  expect(await texts('tok-str')).toEqual(['"John"']);      // and none of the six keys
  expect(await texts('tok-num')).toEqual(['30', '-1.5e3']);
  expect(await texts('tok-bool')).toEqual(['true', 'false']);
  expect(await texts('tok-null')).toEqual(['null']);

  // A colour per type, and none of them the default ink the keys are left in.
  const colour = (sel) => page.locator(sel).first().evaluate(el => getComputedStyle(el).color);
  const colours = [
    await colour('#edit-highlight'),
    await colour('#edit-highlight .tok-str'), await colour('#edit-highlight .tok-num'),
    await colour('#edit-highlight .tok-bool'), await colour('#edit-highlight .tok-null'),
  ];
  expect(new Set(colours).size).toBe(5);
});

// The reader sees the coloured copy, never the textarea's own glyphs, while
// the caret and the selection belong to the textarea. If the two disagree
// about where a glyph goes, the caret drifts off the text.
test('55. the coloured copy lies exactly over the textarea\'s text', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n\t"a": "b"\n}');
  const metrics = (sel) => page.locator(sel).evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.whiteSpace,
            cs.tabSize, cs.paddingTop, cs.paddingLeft, cs.borderTopWidth, cs.borderLeftWidth].join(' | ');
  });
  expect(await metrics('#edit-highlight')).toBe(await metrics('#edit-area'));

  const area = await page.locator('#edit-area').boundingBox();
  const copy = await page.locator('#edit-highlight').boundingBox();
  expect(copy.x).toBe(area.x);
  expect(copy.y).toBe(area.y);
  expect(await drawnText(page)).toBe('{\n\t"a": "b"\n}');

  // The textarea's glyphs are hidden; its caret is not.
  await expect(page.locator('#edit-area')).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#edit-area')).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
});

// The copy is built as markup from whatever was typed or pasted.
test('56. the editor escapes what it colours', async ({ page }) => {
  await page.goto('/');
  const text = '\n{"html": "<b>bold</b> & <img src=x onerror=alert(1)>", "<i>": 1}';
  await type(page, text);
  await expect(page.locator('#edit-highlight :not(span)')).toHaveCount(0);
  expect(await drawnText(page)).toBe(text);
});

test('57. a fault is underlined to the end of its line, and colour carries on past it', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "a": 1\n  "b": 2,\n  "c": "still coloured"\n}');
  await expect(page.locator('#status-left')).toContainText('line 3, column 3');

  await expect(page.locator('#edit-highlight .tok-error')).toHaveText('"b": 2,');
  await expect(page.locator('.edit-error-marker')).toHaveText('3');
  // A lexer, not the parser, does the colouring: one typo costs one line.
  expect(await page.locator('#edit-highlight .tok-num').allTextContents()).toEqual(['1']);
  expect(await page.locator('#edit-highlight .tok-str').allTextContents()).toEqual(['"still coloured"']);
  expect(await drawnText(page)).toBe(await page.locator('#edit-area').inputValue());

  await page.locator('#edit-area').fill('{\n  "a": 1,\n  "b": 2\n}');
  await expect(page.locator('#edit-highlight .tok-error')).toHaveCount(0);
  await expect(page.locator('.edit-error-marker')).toHaveCount(0);
});

// Only the lines on screen are drawn, so that typing costs the same in a long
// document as in a short one. Wherever the editor is scrolled to, the right
// lines have to be there, level with their numbers.
test('58. a long document is numbered and coloured wherever it is scrolled to', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.jsontree.load(
    JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'row ' + i })))));
  await page.locator('#btn-edit').click();
  await expect(page.locator('#status-left')).toContainText('20002 lines');

  expect((await lineNumbers(page))[0]).toBe('1');
  expect((await lineNumbers(page)).length).toBeLessThan(200);      // a window, not all 20,002

  // Row 2500 is lines 10002–10005; its name is on 10004. Put line 10001 at
  // the top of the editor.
  await page.locator('#edit-area').evaluate((el) => { el.scrollTop = 10000 * 18; });
  await expect.poll(async () => (await lineNumbers(page)).includes('10004')).toBe(true);

  const at = await page.evaluate(() => {
    const numbers = document.getElementById('edit-line-numbers').firstChild;
    const from = numbers.data.indexOf('10004');
    const range = document.createRange();
    range.setStart(numbers, from);
    range.setEnd(numbers, from + 5);
    const name = [...document.querySelectorAll('#edit-highlight .tok-str')]
      .find(el => el.textContent === '"row 2500"');
    const area = document.getElementById('edit-area').getBoundingClientRect();
    return {
      number: range.getBoundingClientRect().top - area.top,
      text: name.getBoundingClientRect().top - area.top,
    };
  });
  // Line 10004 starts 12px of padding plus three lines below the top edge.
  expect(at.text).toBeGreaterThanOrEqual(66);
  expect(at.text).toBeLessThan(84);
  expect(Math.abs(at.number - at.text)).toBeLessThan(1);
});

// One enormous line cannot be drawn a window at a time, and colouring all of
// it on every keystroke is what the window exists to avoid.
test('59. a line too long to colour is shown plain, and still numbered', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.jsontree.load(JSON.stringify({ blob: 'x'.repeat(150000), n: 1 })));
  await page.locator('#btn-edit').click();

  await expect(page.locator('#edit-wrap')).toHaveClass(/plain/);
  await expect(page.locator('#edit-highlight')).toBeHidden();
  // With no copy to look at, the textarea has to show its own text.
  await expect(page.locator('#edit-area')).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  expect(await lineNumbers(page)).toEqual(['1', '2', '3', '4']);

  await page.locator('#edit-area').fill('{"n": 1}');
  await expect(page.locator('#edit-wrap')).not.toHaveClass(/plain/);
  await expect(page.locator('#edit-highlight .tok-num')).toHaveText('1');
});

// ----------------------------------------------------------------
// Search, in the source editor
// ----------------------------------------------------------------
const marked = (page) => page.locator('#edit-marks mark').allTextContents();
const PRETTY = JSON.stringify(JSON.parse(SAMPLE), null, 2);

// D5 was find searching a hidden tree from the editor, so it was made to
// refuse. Now the editor is searched for what it shows: its text.
test('60. search in the editor marks every occurrence in the text', async ({ page }) => {
  await load(page);
  await page.locator('#btn-edit').click();
  await page.keyboard.press('Meta+f');
  await expect(page.locator('#search-input')).toBeFocused();

  // Occurrences in the text, whatever the case: the key "street" and the
  // value "123 Main St" each hold one.
  await page.keyboard.type('ST');
  expect(await marked(page)).toEqual(['st', 'St']);
  await expect(page.locator('#search-count')).toHaveText('1/2');
  await expect(page.locator('#edit-marks mark.current')).toHaveCount(1);
  await expect(page.locator('#status-left')).toHaveText('Valid JSON · 1 of 2 matches for “ST” · 249 B');
  // The text itself is untouched, and so is the coloured copy of it.
  await expect(page.locator('#edit-area')).toHaveValue(PRETTY);
  expect(await drawnText(page)).toBe(PRETTY);

  await page.keyboard.press('Enter');
  await expect(page.locator('#search-count')).toHaveText('2/2');
  expect(await page.locator('#edit-marks mark').evaluateAll(
    els => els.map(el => el.classList.contains('current')))).toEqual([false, true]);
  await page.keyboard.press('Meta+g');                    // wraps
  await expect(page.locator('#search-count')).toHaveText('1/2');
});

// The marks are a third copy of the text with only their ground showing. If
// that copy disagrees with the others about where a glyph goes, the mark
// lands beside the text instead of under it.
test('61. a mark lies exactly under the text it marks', async ({ page }) => {
  await load(page);
  await page.locator('#btn-edit').click();
  // A whole string token, quotes and all, so the coloured copy has an element
  // of exactly the same extent to compare with.
  await page.locator('#search-input').fill('"Springfield"');
  await expect(page.locator('#search-count')).toHaveText('1/1');

  const boxes = await page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const token = [...document.querySelectorAll('#edit-highlight .tok-str')]
      .find(el => el.textContent === '"Springfield"');
    return { mark: rect(document.querySelector('#edit-marks mark.current')), token: rect(token) };
  });
  for (let i = 0; i < 4; i++) expect(Math.abs(boxes.mark[i] - boxes.token[i])).toBeLessThan(0.5);

  // And it is paint only: the marks never take the pointer from the textarea.
  await expect(page.locator('#edit-marks')).toHaveCSS('pointer-events', 'none');
});

test('62. stepping to a match scrolls the editor to it, down and across', async ({ page }) => {
  await page.goto('/');
  const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i, name: 'row ' + i }));
  rows[2500].note = 'x'.repeat(4000) + ' needle';          // far down, and far along its line
  await page.evaluate((t) => window.jsontree.load(t), JSON.stringify(rows));
  await page.locator('#btn-edit').click();
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('1/1');

  const seen = await page.evaluate(() => {
    const area = document.getElementById('edit-area');
    const a = area.getBoundingClientRect();
    const m = document.querySelector('#edit-marks mark.current').getBoundingClientRect();
    return {
      scrollTop: area.scrollTop,
      scrollLeft: area.scrollLeft,
      inside: m.top >= a.top && m.bottom <= a.bottom && m.left >= a.left && m.right <= a.left + area.clientWidth,
    };
  });
  expect(seen.scrollTop).toBeGreaterThan(100000);
  expect(seen.scrollLeft).toBeGreaterThan(10000);
  expect(seen.inside).toBe(true);
  // Only a window of the text is marked, as only a window of it is drawn.
  expect((await lineNumbers(page)).length).toBeLessThan(200);
});

// Typing in the editor moves every match after the caret. The marks and the
// tally follow, and the search keeps its place rather than starting again.
test('63. a standing search follows edits to the text and keeps its place', async ({ page }) => {
  await page.goto('/');
  await type(page, '["cat", "dog", "cat"]');
  await page.locator('#search-input').fill('cat');
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-count')).toHaveText('2/2');

  await page.locator('#edit-area').fill('["cat", "dog", "cat", "cat"]');
  await expect(page.locator('#search-count')).toHaveText('2/3');
  expect(await marked(page)).toEqual(['cat', 'cat', 'cat']);
  await expect(page.locator('#status-left')).toContainText('2 of 3 matches for “cat”');

  // Format rewrites the text without the reader typing; the marks follow that too.
  await page.locator('#btn-format').click();
  expect(await marked(page)).toEqual(['cat', 'cat', 'cat']);
  expect(await page.locator('#edit-marks').evaluate(el => el.textContent))
    .toBe(await page.locator('#edit-area').inputValue());

  await page.locator('#edit-area').fill('["dog"]');
  await expect(page.locator('#search-count')).toHaveText('0/0');
  expect(await marked(page)).toEqual([]);
});

test('64. Escape hands the caret back to the editor, on the match it stopped at', async ({ page }) => {
  await load(page);
  await page.setViewportSize({ width: 900, height: 240 });      // too short to show all 18 lines
  await page.locator('#btn-edit').click();
  await page.keyboard.press('Meta+f');
  await page.keyboard.type('admin');                            // on line 15, out of sight
  const scrolled = await page.locator('#edit-area').evaluate(el => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  // Taking the focus must not throw the view back to where the caret was.
  expect(await page.locator('#edit-area').evaluate(
    el => [el.scrollTop, el.value.slice(el.selectionStart, el.selectionEnd)])).toEqual([scrolled, 'admin']);

  await page.keyboard.press('Meta+f');
  await page.keyboard.type('springfield');
  await page.keyboard.press('Escape');

  await expect(page.locator('#edit-area')).toBeFocused();
  expect(await page.locator('#edit-area').evaluate(
    el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('Springfield');
  await expect(page.locator('#search-input')).toHaveValue('');
  expect(await marked(page)).toEqual([]);
  await expect(page.locator('#status-left')).toHaveText('Valid JSON · 249 B · 18 lines');

  // From the textarea, Escape clears a standing search and leaves the caret be.
  await page.locator('#search-input').fill('john');
  await page.locator('#edit-area').click();
  const caret = await page.locator('#edit-area').evaluate(el => el.selectionStart);
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#edit-area')).toBeFocused();
  expect(await page.locator('#edit-area').evaluate(el => el.selectionStart)).toBe(caret);
});

// The field is one control for two views, so what is in it stays when the
// view changes, and is looked for again in the new one.
test('65. a search stands when the view changes, and is run in the new one', async ({ page }) => {
  await load(page, '{"aa":"a","b":1}');
  await page.locator('#search-input').fill('a');
  // Rows over the tree: `aa : "a"` is one of them.
  expect(await tinted(page)).toEqual(['aa']);
  await expect(page.locator('#search-count')).toHaveText('1/1');

  // Occurrences in the text: the same row is three of those.
  await page.locator('#btn-edit').click();
  await expect(page.locator('#search-input')).toHaveValue('a');
  await expect(page.locator('#search-count')).toHaveText('1/3');
  expect(await marked(page)).toEqual(['a', 'a', 'a']);
  await expect(page.locator('#edit-marks mark.current')).toHaveCount(1);

  await page.locator('#edit-area').fill('{"aa":"a","b":1,"c":"a"}');
  await page.locator('#btn-edit').click();
  expect(await tinted(page)).toEqual(['aa', 'c']);
  await expect(page.locator('#search-count')).toHaveText('1/2');
  await expect(page.locator('.tree-row.selected')).toHaveAttribute('data-path', 'aa');
});

test('66. invalid JSON can still be searched, and its error stands', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "a": tru,\n  "b": "<true>"\n}');
  await expect(page.locator('#status-left')).toHaveClass(/error/);

  await page.locator('#search-input').fill('tru');
  expect(await marked(page)).toEqual(['tru', 'tru']);
  await expect(page.locator('#search-count')).toHaveText('1/2');
  await expect(page.locator('#status-left')).toHaveClass(/error/);
  await expect(page.locator('#status-left')).toContainText('Invalid JSON — line 2');

  // The marked copy is built as markup too, and has to escape what it copies.
  await page.locator('#search-input').fill('<true>');
  expect(await marked(page)).toEqual(['<true>']);
  expect(await page.locator('#edit-marks').evaluate(el => el.textContent))
    .toBe(await page.locator('#edit-area').inputValue());
});

// A line too long to colour is too long to draw a marked copy of. The matches
// are still counted and stepped through; the current one is boxed, and the
// editor is scrolled along the line to it. The box is placed by asking the
// textarea where the text is — measuring a copy lands tens of pixels out on a
// line like this one, which changes font thousands of times.
test('67. on a line too long to colour, the current match is boxed where the text is', async ({ page }) => {
  await page.goto('/');
  const blob = 'x'.repeat(60000) + 'ab 東京 cd 😀 ef'.repeat(2000) + ' needle ' + 'y'.repeat(30000) + ' needle';
  await page.evaluate((t) => window.jsontree.load(t), JSON.stringify({ blob, n: 1 }));
  await page.locator('#btn-edit').click();
  await expect(page.locator('#edit-wrap')).toHaveClass(/plain/);

  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('1/2');
  await expect(page.locator('#edit-marks mark')).toHaveCount(1);        // the current one only

  // Hit-test the textarea just inside each end of the box: the caret has to
  // land on the match's own first and last boundaries.
  const where = (nth) => page.evaluate((nth) => {
    const area = document.getElementById('edit-area');
    const a = area.getBoundingClientRect();
    const m = document.querySelector('#edit-marks mark.current').getBoundingClientRect();
    let at = -1;
    for (let i = 0; i <= nth; i++) at = area.value.indexOf('needle', at + 1);
    const caret = (x) => document.caretPositionFromPoint(x, m.top + m.height / 2).offset - at;
    return {
      starts: caret(m.left + 2), ends: caret(m.right - 2), second: caret(m.left + 5),
      inside: m.left >= a.left && m.right <= a.left + area.clientWidth && m.top >= a.top && m.bottom <= a.bottom,
      scrollLeft: area.scrollLeft,
    };
  }, nth);

  let at = await where(0);
  expect(at.scrollLeft).toBeGreaterThan(100000);
  expect(at.inside).toBe(true);
  expect([at.starts, at.second, at.ends]).toEqual([0, 1, 6]);

  // The box stays on the text as the editor is scrolled under it.
  await page.locator('#edit-area').evaluate((el) => { el.scrollLeft += 120; });
  await expect.poll(async () => (await where(0)).starts).toBe(0);
  expect((await where(0)).ends).toBe(6);

  await page.keyboard.press('Enter');
  await expect(page.locator('#search-count')).toHaveText('2/2');
  const first = at.scrollLeft;
  at = await where(1);
  expect(at.scrollLeft).toBeGreaterThan(first + 100000);
  expect(at.inside).toBe(true);
  expect([at.starts, at.second, at.ends]).toEqual([0, 1, 6]);

  // Escape leaves the match selected in the text, and the text where it was.
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit-area')).toBeFocused();
  expect(await page.locator('#edit-area').evaluate(
    el => [el.value.slice(el.selectionStart, el.selectionEnd), el.selectionStart === el.value.lastIndexOf('needle')]))
    .toEqual(['needle', true]);
  expect(await page.locator('#edit-area').evaluate(el => el.scrollLeft)).toBe(at.scrollLeft);
});

// ----------------------------------------------------------------
// The search field in a narrow window
// ----------------------------------------------------------------
test('68. in a narrow window the search field folds to its magnifier and opens on focus', async ({ page }) => {
  await load(page);
  const width = () => page.locator('#search-field').evaluate(el => el.getBoundingClientRect().width);

  expect(await width()).toBe(230);                               // a wide window: the whole field
  await page.setViewportSize({ width: 700, height: 600 });
  expect(await width()).toBe(26);
  await expect(page.locator('#search-next')).toBeHidden();
  const copyAt = (await page.locator('#btn-copy').boundingBox()).x;

  // ⌘F opens it across the toolbar, over the actions, which do not move.
  await page.keyboard.press('Meta+f');
  await expect(page.locator('#search-input')).toBeFocused();
  expect(await width()).toBeGreaterThan(600);
  await expect(page.locator('#toolbar')).toHaveCSS('height', '38px');
  expect((await page.locator('#btn-copy').boundingBox()).x).toBe(copyAt);

  // Pressing a chevron must not shut it under the pointer.
  await page.keyboard.type('a');
  await page.locator('#search-next').click();
  await expect(page.locator('#search-count')).toContainText('2/');
  await expect(page.locator('#search-input')).toBeFocused();
  expect(await width()).toBeGreaterThan(600);

  // Clicking away folds it again; the fill says a search is still standing.
  await page.locator('#tree-scroll').click({ position: { x: 300, y: 400 } });
  expect(await width()).toBe(26);
  await expect(page.locator('#search-field')).toHaveClass(/has-value/);
  const standing = await page.locator('#search-field').evaluate(el => getComputedStyle(el).backgroundColor);
  expect((await tinted(page)).length).toBeGreaterThan(1);

  // Pressing the magnifier opens it again, with the query still there.
  await page.locator('#search-field').click();
  await expect(page.locator('#search-input')).toBeFocused();
  await expect(page.locator('#search-input')).toHaveValue('a');
  await page.keyboard.press('Escape');
  expect(await width()).toBe(26);
  expect(await page.locator('#search-field').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(standing);
});

// ----------------------------------------------------------------
// The caret's line in the editor
// ----------------------------------------------------------------
// Where line n lies on the page, worked out from the textarea itself.
const lineTop = (page, n) => page.locator('#edit-area').evaluate((el, n) =>
  el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop) + n * 18 - el.scrollTop, n);
const bandTop = async (page) => (await page.locator('#edit-current-line').boundingBox()).y;

test('69. the caret\'s line is banded and its number is in full ink', async ({ page }) => {
  await page.goto('/');
  const band = page.locator('#edit-current-line');
  const number = page.locator('#edit-current-number');

  // An empty editor still has a first line, and the caret is on it.
  await expect(band).toBeVisible();
  await expect(number).toHaveText('1');
  expect(await bandTop(page)).toBe(await lineTop(page, 0));

  await type(page, PRETTY);                        // 18 lines; the caret ends on the last
  await expect(number).toHaveText('18');
  expect(await bandTop(page)).toBe(await lineTop(page, 17));

  // The band is one line high and runs the width of the text area; the
  // number takes the text's ink rather than the gutter's.
  const box = await band.boundingBox();
  const code = await page.locator('#edit-code').boundingBox();
  expect(box.height).toBe(18);
  expect(box.x).toBe(code.x);
  expect(box.width).toBe(code.width);
  const ink = (sel) => page.locator(sel).evaluate(el => getComputedStyle(el).color);
  expect(await ink('#edit-current-number')).toBe(await ink('#edit-highlight'));
  expect(await ink('#edit-current-number')).not.toBe(await ink('#edit-line-numbers'));
  expect((await number.boundingBox()).y).toBe(await lineTop(page, 17));

  // It follows the caret, by keyboard and by mouse.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await expect(number).toHaveText('15');
  expect(await bandTop(page)).toBe(await lineTop(page, 14));
  await page.locator('#edit-area').click({ position: { x: 120, y: 12 + 2 * 18 + 9 } });
  await expect(number).toHaveText('3');
  expect(await bandTop(page)).toBe(await lineTop(page, 2));

  // A selection takes the band away; the number goes with the end that moves.
  await page.keyboard.press('Shift+ArrowDown');
  await expect(band).toBeHidden();
  await expect(number).toHaveText('4');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(number).toHaveText('2');
  await page.keyboard.press('ArrowLeft');
  await expect(band).toBeVisible();
  expect(await bandTop(page)).toBe(await lineTop(page, 1));

  // Typing a new line takes it down with the caret.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(number).toHaveText('3');
  expect(await bandTop(page)).toBe(await lineTop(page, 2));
});

test('70. the band stays on its line as the editor scrolls', async ({ page }) => {
  await page.goto('/');
  const long = JSON.stringify(Array.from({ length: 498 }, (_, i) => ({ id: i }).id), null, 2);   // 500 lines
  await type(page, long);
  const number = page.locator('#edit-current-number');
  const scrollTo = (y) => page.locator('#edit-area').evaluate((el, y) => { el.scrollTop = y; }, y);

  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await expect(number).toHaveText('1');
  expect(await bandTop(page)).toBe(await lineTop(page, 0));

  // Scrolled a little: the band goes up with its line.
  await scrollTo(30);
  await expect.poll(() => bandTop(page)).toBe(38 + 12 - 30);
  expect(await bandTop(page)).toBe(await lineTop(page, 0));
  await expect(number).toHaveText('1');

  // Scrolled far away: that line is no longer drawn, so neither is its number.
  await scrollTo(5000);
  await expect(number).toBeHidden();
  expect(await bandTop(page)).toBe(await lineTop(page, 0));

  // And the caret sent to the far end is banded there.
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect(number).toHaveText('500');
  await expect(number).toBeVisible();
  expect(await bandTop(page)).toBe(await lineTop(page, 499));
  const editor = await page.locator('#edit-area').boundingBox();
  expect(await bandTop(page)).toBeLessThan(editor.y + editor.height);
});
