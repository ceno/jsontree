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
  await expect(page.locator('#status-path')).toHaveText('⌘F Find');
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

  await page.keyboard.press('Meta+f');
  await expect(page.locator('#findbar')).toHaveClass(/open/);
  expect((await bar.boundingBox()).height).toBe(resting);

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

test('5. connector columns stay in layout at every depth', async ({ page }) => {
  await load(page);
  const rows = page.locator('#tree-container .tree-row');
  // Root: one column, no elbow. Depth 1: two columns, one elbow.
  await expect(rows.nth(0).locator('.tc')).toHaveCount(1);
  await expect(rows.nth(0).locator('.tc-elbow')).toHaveCount(0);
  await expect(rows.nth(1).locator('.tc')).toHaveCount(2);
  await expect(rows.nth(1).locator('.tc-elbow')).toHaveCount(1);
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
// Find
// ----------------------------------------------------------------
test('9. find highlights matches, counts them, and reveals buried nodes', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await expect(page.locator('#findbar')).toHaveClass(/open/);

  await page.locator('#find-input').fill('lat');
  // `lat` is three levels down, inside a collapsed subtree.
  await expect(page.locator('#find-count')).toHaveText('1 of 1');
  await expect(page.locator('.tree-row.selected .tree-label')).toContainText('lat : 37.3861');
  await expect(page.locator('mark.find-match.current')).toHaveText('lat');
  await expect(page.locator('#status-path')).toHaveText('address.geo.lat');
});

test('10. find cycles through matches and wraps around', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await page.locator('#find-input').fill('a');

  const total = parseInt((await page.locator('#find-count').textContent()).split(' of ')[1], 10);
  expect(total).toBeGreaterThan(2);
  await expect(page.locator('#find-count')).toHaveText('1 of ' + total);

  await page.locator('#find-next').click();
  await expect(page.locator('#find-count')).toHaveText('2 of ' + total);
  await page.locator('#find-prev').click();
  await expect(page.locator('#find-count')).toHaveText('1 of ' + total);
  // Wrap backwards off the first match.
  await page.locator('#find-prev').click();
  await expect(page.locator('#find-count')).toHaveText(total + ' of ' + total);
});

test('11. Escape closes find and removes every highlight', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await page.locator('#find-input').fill('name');
  await expect(page.locator('mark.find-match').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#findbar')).not.toHaveClass(/open/);
  await expect(page.locator('mark.find-match')).toHaveCount(0);
  // The label text survives the highlight round-trip intact.
  await expect(page.locator('#tree-container .tree-label').nth(1)).toHaveText('name : "John"');
});

// ----------------------------------------------------------------
// Toolbar actions
// ----------------------------------------------------------------
test('14. Copy puts the pretty-printed document on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page, '{"b":2,"a":1}');
  await page.locator('#btn-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('{\n  "b": 2,\n  "a": 1\n}');   // key order preserved
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
  expect(top).toBe(60);   // three 20px lines down, not on line 1
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

// D5: find searched the hidden tree while the editor was open, reporting a
// match count and a path for rows nobody could see.
test('28. find refuses to open over the source editor', async ({ page }) => {
  await load(page);
  await page.locator('#btn-edit').click();
  await page.keyboard.press('Meta+f');

  await expect(page.locator('#findbar')).not.toHaveClass(/open/);
  await expect(page.locator('#edit-area')).toBeFocused();
  await expect(page.locator('#status-left')).toContainText('leave the editor first');
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
// the pasted text was unreachable. Paste only exists in the editor now, so the
// text lands in front of the reader with the error beside it.
test('30. pasting unparseable text keeps it in the editor with the error', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.evaluate(() => navigator.clipboard.writeText('not json at all'));
  await page.locator('#btn-edit').click();
  await page.locator('#btn-paste').click();

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

// D12: a 0-height box still paints its border under box-sizing: border-box.
test('35. the closed find bar takes no vertical space', async ({ page }) => {
  await load(page);
  expect(await page.locator('#findbar').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  await page.keyboard.press('Meta+f');
  await expect(page.locator('#findbar')).toHaveClass(/open/);
  await page.waitForTimeout(250);
  expect(await page.locator('#findbar').evaluate(el => el.getBoundingClientRect().height)).toBe(34);
});

// D9: the toolbar had no give, so the find button was pushed off the
// right-hand edge on a narrow window.
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
      for (const id of ['btn-find-open', 'btn-edit']) {
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
const EDITOR_ACTIONS = ['View', 'Copy', 'Paste', 'Format', 'Minify'];

test('44. the toolbar shows the tree\'s actions over the tree and the editor\'s while editing', async ({ page }) => {
  await page.goto('/');
  expect(await toolbarLabels(page)).toEqual(EDITOR_ACTIONS);    // opens in the editor
  // Find is the only icon on the right, in either view.
  await expect(page.locator('#toolbar .tb-icon-btn')).toHaveCount(1);

  await page.evaluate((t) => window.jsontree.load(t), SAMPLE);
  expect(await toolbarLabels(page)).toEqual(TREE_ACTIONS);
  const copyAt = (await page.locator('#btn-copy').boundingBox()).x;

  await page.locator('#btn-edit').click();
  expect(await toolbarLabels(page)).toEqual(EDITOR_ACTIONS);
  // Copy is common to both and must not move under the pointer.
  expect((await page.locator('#btn-copy').boundingBox()).x).toBe(copyAt);
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

// Minify used to copy; now getting minified JSON out is Minify, then Copy.
test('47. Copy in the editor copies the text as it stands', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await type(page, '{\n  "name": "John",\n  "age": 30\n}');
  await page.locator('#btn-minify').click();
  await page.locator('#btn-copy').click();

  await expect(page.locator('#status-left')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toBe('{"name":"John","age":30}');
});

test('48. Paste in the editor replaces the text with the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.evaluate(() => navigator.clipboard.writeText('{"pasted":true}'));
  await page.locator('#btn-edit').click();
  await page.locator('#btn-paste').click();
  await expect(page.locator('#edit-area')).toHaveValue('{"pasted":true}');

  await page.locator('#btn-edit').click();
  await expect(page.locator('.tree-row[data-path="pasted"]')).toBeVisible();
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
test('52. find neither matches the counts nor disturbs them', async ({ page }) => {
  await load(page, '{"first":{"a":1},"second":[1,2]}');
  await page.keyboard.press('Meta+f');
  await page.locator('#find-input').fill('key');
  await expect(page.locator('#find-count')).toHaveText('0 of 0');
  await page.locator('#find-input').fill('item');
  await expect(page.locator('#find-count')).toHaveText('0 of 0');

  await page.locator('#find-input').fill('first');
  await expect(page.locator('#find-count')).toHaveText('1 of 1');
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

  // Format, Minify and Paste rewrite the text without the reader typing, and
  // the numbers and the coloured copy have to follow those too.
  await page.locator('#btn-format').click();
  expect(await lineNumbers(page)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(await drawnText(page)).toBe(await page.locator('#edit-area').inputValue());

  await page.locator('#btn-minify').click();
  expect(await lineNumbers(page)).toEqual(['1']);
  expect(await drawnText(page)).toBe('{"a":1,"b":[1,2]}');

  await page.evaluate(() => navigator.clipboard.writeText('[\n  true\n]'));
  await page.locator('#btn-paste').click();
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
  await page.locator('#edit-area').evaluate((el) => { el.scrollTop = 10000 * 20; });
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
  expect(at.text).toBeGreaterThanOrEqual(72);
  expect(at.text).toBeLessThan(92);
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
