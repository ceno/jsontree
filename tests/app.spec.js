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

/** Load a document the way the extension does, then wait for the tree. */
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

/** Put text into the source editor and let it validate. */
async function type(page, text) {
  await page.locator('#btn-edit').click();
  await page.locator('#edit-area').fill(text);
}

// ----------------------------------------------------------------
// Shell
// ----------------------------------------------------------------
test('1. opens on the empty state with the keyboard hint showing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveClass(/empty/);
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#tree-container .tree-row')).toHaveCount(0);
  await expect(page.locator('#status-path')).toHaveText('⌘K Commands · ⌘F Find');
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
// Command palette
// ----------------------------------------------------------------
test('12. the palette opens on ⌘K and filters fuzzily', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+k');
  await expect(page.locator('#palette-overlay')).toHaveClass(/open/);

  await page.locator('#palette-input').fill('coll');
  await expect(page.locator('.palette-item').first()).toContainText('Collapse All');
  await expect(page.locator('.palette-item', { hasText: 'Format' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#palette-overlay')).not.toHaveClass(/open/);
});

test('13. a palette command runs against the document', async ({ page }) => {
  await load(page);
  await expand(page, 'address');
  await expect(page.locator('.tree-row[data-path="address.city"]')).toBeVisible();

  await page.keyboard.press('Meta+k');
  await page.locator('#palette-input').fill('collapse');
  await page.keyboard.press('Enter');

  await expect(page.locator('#palette-overlay')).not.toHaveClass(/open/);
  await expect(page.locator('.tree-row[data-path="address.city"]')).toBeHidden();
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

test('15. Minify copies the document without whitespace', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page, '{\n  "name": "John",\n  "age": 30\n}');
  await page.locator('#btn-minify').click();
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toBe('{"name":"John","age":30}');
  await expect(page.locator('#status-left')).toHaveText('Copied minified JSON');
});

test('16. Copy Selection copies just the selected subtree', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.locator('.tree-row[data-path="address"]').click();
  await page.keyboard.press('Meta+k');
  await page.locator('#palette-input').fill('copy selection');
  await page.keyboard.press('Enter');

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(text).city).toBe('Springfield');
});

test('17. Clear empties the document and returns to the empty state', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+k');
  await page.locator('#palette-input').fill('clear');
  await page.keyboard.press('Enter');

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

test('19. Format re-indents the source in place', async ({ page }) => {
  await page.goto('/');
  await type(page, '{"b":2,"a":1}');
  await page.locator('#btn-format').click();
  await expect(page.locator('#edit-area')).toHaveValue('{\n  "b": 2,\n  "a": 1\n}');
});

test('20. invalid JSON reports a real line and column, with no modal', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "a": 1\n  "b": 2\n}');

  await expect(page.locator('#status-left')).toHaveClass(/error/);
  await expect(page.locator('#status-left')).toHaveText('Invalid JSON — line 3, column 3: expected "," or "}"');
  await expect(page.locator('.edit-error-marker')).toHaveCount(1);
  // Nothing modal: the document stays reachable behind the message.
  await expect(page.locator('#palette-overlay')).not.toHaveClass(/open/);
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
  await page.locator('#btn-edit').click();
  for (const [input, expected] of cases) {
    await page.locator('#edit-area').fill(input);
    await expect(page.locator('#status-left')).toHaveText(expected);
  }
});

test('21d. the error marker tracks the offending line', async ({ page }) => {
  await page.goto('/');
  await type(page, '{\n  "a": 1,\n  "b": "x",\n  "c": "\\x"\n}');
  await expect(page.locator('#status-left')).toContainText('line 4');
  const top = await page.locator('.edit-error-marker').evaluate(el => parseFloat(el.style.top));
  expect(top).toBeGreaterThan(60);   // line 4, not line 1 (~7.6px)
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

// D1: focus was left in the hidden palette input, so the window keydown
// handler treated every arrow key as typing and tree navigation went dead.
test('25. closing the palette hands focus back and arrows still work', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement.id)).not.toBe('palette-input');

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row.selected')).toHaveCount(1);
});

// D1: Escape inside the palette bubbled to the window handler, which saw a
// closed palette and went on to close the find bar underneath it.
test('26. Escape in the palette does not also close the find bar', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+f');
  await page.locator('#find-input').fill('name');
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Escape');

  await expect(page.locator('#findbar')).toHaveClass(/open/);
  await expect(page.locator('#find-input')).toHaveValue('name');
});

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
// the pasted text was unreachable.
test('30. pasting unparseable text opens it in the editor', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.evaluate(() => navigator.clipboard.writeText('not json at all'));
  await page.locator('#btn-paste').click();

  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(page.locator('#edit-area')).toHaveValue('not json at all');
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

// D9: the toolbar had no give, so the find and palette buttons were pushed
// off the right-hand edge on a narrow window.
test('36. the toolbar keeps every control reachable when narrow', async ({ page }) => {
  await load(page);
  for (const width of [1180, 620, 460, 380]) {
    await page.setViewportSize({ width, height: 700 });
    const overflow = await page.locator('#toolbar').evaluate(
      el => el.scrollWidth - el.clientWidth);
    expect(overflow, `toolbar overflows at ${width}px`).toBeLessThanOrEqual(0);
    for (const id of ['btn-find-open', 'btn-palette-open', 'btn-edit']) {
      const box = await page.locator('#' + id).boundingBox();
      expect(box.x + box.width, `${id} off-screen at ${width}px`).toBeLessThanOrEqual(width);
    }
  }
});

// D14: Tab moved focus out of the palette and Escape then did nothing.
test('37. Escape closes the palette even after Tab moves focus out', async ({ page }) => {
  await load(page);
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette-overlay')).not.toHaveClass(/open/);
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

// The Edit button is the only way back out of the editor, so it has to say so.
test('40. the Edit button becomes Done while editing', async ({ page }) => {
  await load(page);
  await expect(page.locator('#btn-edit')).toHaveText('Edit');

  await page.locator('#btn-edit').click();
  await expect(page.locator('#btn-edit')).toHaveText('Done');
  await expect(page.locator('#btn-edit')).toHaveClass(/on/);

  await page.locator('#btn-edit').click();
  await expect(page.locator('#btn-edit')).toHaveText('Edit');
  await expect(page.locator('#btn-edit')).not.toHaveClass(/on/);
});

// It must not get stuck on "Done" when the editor refuses to close.
test('41. the Edit button stays Done while the JSON is invalid', async ({ page }) => {
  await load(page);
  await type(page, '{"a":');
  await page.locator('#btn-edit').click();          // refused
  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(page.locator('#btn-edit')).toHaveText('Done');

  await page.locator('#edit-area').fill('{"a":1}');
  await page.locator('#btn-edit').click();
  await expect(page.locator('#btn-edit')).toHaveText('Edit');
});

// The same entry point the extension uses must leave the button consistent.
test('42. loading unparseable text leaves the button reading Done', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.jsontree.load('{"a":'));
  await expect(page.locator('#edit-area')).toBeVisible();
  await expect(page.locator('#btn-edit')).toHaveText('Done');
});
