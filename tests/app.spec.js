// @ts-check
const { test, expect } = require('@playwright/test');

const SAMPLE_JSON = JSON.stringify({
  name: "John",
  age: 30,
  active: true,
  score: null,
  address: {
    street: "123 Main St",
    city: "Springfield",
    geo: {
      lat: 37.3861,
      lng: -122.0839
    }
  },
  tags: ["admin", "user"]
});

// ----------------------------------------------------------------
// 1. Loads with Text tab active, placeholder visible
// ----------------------------------------------------------------
test('1. loads with Text tab active and placeholder visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#tab-text')).toHaveClass(/active/);
  await expect(page.locator('#panel-text')).toHaveClass(/active/);
  await expect(page.locator('#panel-viewer')).not.toHaveClass(/active/);
  const placeholder = await page.locator('#json-input').getAttribute('placeholder');
  expect(placeholder).toContain('Paste the JSON code here');
});

// ----------------------------------------------------------------
// 2. Format: minified → 2-space-indented; key order preserved
// ----------------------------------------------------------------
test('2. Format produces 2-space-indented output with key order preserved', async ({ page }) => {
  await page.goto('/');
  const minified = '{"b":2,"a":1}';
  await page.locator('#json-input').fill(minified);
  await page.locator('#btn-format').click();
  const val = await page.locator('#json-input').inputValue();
  expect(val).toBe('{\n  "b": 2,\n  "a": 1\n}');
});

// ----------------------------------------------------------------
// 3. Remove white space: pretty → minified
// ----------------------------------------------------------------
test('3. Remove white space produces minified output', async ({ page }) => {
  await page.goto('/');
  const pretty = '{\n  "name": "John",\n  "age": 30\n}';
  await page.locator('#json-input').fill(pretty);
  await page.locator('#btn-minify').click();
  const val = await page.locator('#json-input').inputValue();
  expect(val).toBe('{"name":"John","age":30}');
});

// ----------------------------------------------------------------
// 4. Clear empties textarea
// ----------------------------------------------------------------
test('4. Clear empties the textarea', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill('{"x":1}');
  await page.locator('#btn-clear').click();
  const val = await page.locator('#json-input').inputValue();
  expect(val).toBe('');
});

// ----------------------------------------------------------------
// 5. Invalid JSON + Format → error dialog; OK dismisses
// ----------------------------------------------------------------
test('5. Format on invalid JSON shows error dialog and OK dismisses', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill('not json');
  await page.locator('#btn-format').click();
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#modal-title')).toHaveText('JSON error');
  await expect(page.locator('#modal-message')).toHaveText('Invalid JSON variable');
  await page.locator('#modal-ok-btn').click();
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);
});

// ----------------------------------------------------------------
// 6. Invalid JSON + click Viewer tab → dialog, stays on Text tab
// ----------------------------------------------------------------
test('6. Clicking Viewer tab with invalid JSON shows error and stays on Text tab', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill('invalid json here');
  await page.locator('#tab-viewer').click();
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#modal-title')).toHaveText('JSON error');
  // Close dialog
  await page.locator('#modal-ok-btn').click();
  // Still on Text tab
  await expect(page.locator('#tab-text')).toHaveClass(/active/);
  await expect(page.locator('#panel-text')).toHaveClass(/active/);
});

// ----------------------------------------------------------------
// 7. Valid nested JSON → Viewer shows root JSON, first-level children,
//    correct labels/quoting for string/number/boolean/null leaves
// ----------------------------------------------------------------
test('7. Valid JSON builds correct tree with proper labels', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();
  await expect(page.locator('#panel-viewer')).toHaveClass(/active/);

  // Root node labelled JSON
  const rootLabel = page.locator('.tree-label').first();
  await expect(rootLabel).toHaveText('JSON');

  // String leaf: name : "John"
  const labels = page.locator('.tree-label');
  const texts = await labels.allTextContents();
  expect(texts).toContain('name : "John"');
  expect(texts).toContain('age : 30');
  expect(texts).toContain('active : true');
  expect(texts).toContain('score : null');
});

// ----------------------------------------------------------------
// 8. Expand/collapse via expander; deeper levels hidden until expanded
//    (uses Playwright's built-in polling to tolerate the 250ms slide animation)
// ----------------------------------------------------------------
test('8. Expand and collapse via expander box', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();

  // "address" node at depth 1 — find its row
  const addressLabel = page.locator('.tree-label', { hasText: /^address$/ });
  await expect(addressLabel).toBeVisible();

  // Its children (geo, street, city) should be hidden (collapsed by default at depth 1)
  const geoLabel = page.locator('.tree-label', { hasText: /^geo$/ });
  await expect(geoLabel).not.toBeVisible();

  // Find the expander box next to "address"
  const addressRow = page.locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^address$/ }) });
  const expander = addressRow.locator('.expander-box');
  await expander.click();

  // geo should become visible as animation reveals it (Playwright polls up to 5s)
  await expect(geoLabel).toBeVisible();
  // Let the expand animation finish — clicks during it are intentionally ignored
  await page.waitForTimeout(400);

  // Collapse again — polls until display:none is applied after animation ends (~250ms)
  await expander.click();
  await expect(geoLabel).not.toBeVisible({ timeout: 2000 });
});

// ----------------------------------------------------------------
// 16. Animation cleanup: no leftover inline styles after completion;
//     rapid double-toggle leaves tree in correct final state
// ----------------------------------------------------------------
test('16. Expand animation leaves no inline styles; rapid-toggle resolves cleanly', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();

  const addressRow = page.locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^address$/ }) });
  const expander = addressRow.locator('.expander-box');
  const geoLabel = page.locator('.tree-label', { hasText: /^geo$/ });

  // --- Part a: expand, let animation finish, verify clean DOM ---
  await expander.click();
  await expect(geoLabel).toBeVisible();
  // Wait comfortably past the 250ms animation duration
  await page.waitForTimeout(400);

  // No leftover inline height or overflow on the children container
  const inlineStylesAfterExpand = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.tree-label')].find(l => l.textContent === 'address');
    if (!label) return 'not-found';
    const childrenEl = label.closest('.tree-node').querySelector(':scope > .tree-children');
    if (!childrenEl) return 'no-children';
    return (childrenEl.style.height || '') + '|' + (childrenEl.style.overflow || '');
  });
  expect(inlineStylesAfterExpand).toBe('|');

  // No temporary animation wrapper div should remain — first child must be .tree-node
  const hasSpuriousWrapper = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.tree-label')].find(l => l.textContent === 'address');
    if (!label) return false;
    const childrenEl = label.closest('.tree-node').querySelector(':scope > .tree-children');
    if (!childrenEl || !childrenEl.firstChild) return false;
    return !childrenEl.firstChild.classList.contains('tree-node');
  });
  expect(hasSpuriousWrapper).toBe(false);

  // --- Part b: rapid double-click — the second click lands mid-animation
  // and must be IGNORED, so the collapse simply runs to completion ---
  // Click 1: start collapse animation
  await expander.click();
  // Click 2: immediately, before 250ms — ignored while animating
  await expander.click();

  // Wait for the animation to complete
  await page.waitForTimeout(400);

  // Must be fully collapsed with no leftover styles
  await expect(geoLabel).not.toBeVisible();

  // A click after the animation finished works normally again
  await expander.click();
  await page.waitForTimeout(400);
  await expect(geoLabel).toBeVisible();

  const inlineStylesAfterRapid = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.tree-label')].find(l => l.textContent === 'address');
    if (!label) return 'not-found';
    const childrenEl = label.closest('.tree-node').querySelector(':scope > .tree-children');
    if (!childrenEl) return 'no-children';
    return (childrenEl.style.height || '') + '|' + (childrenEl.style.overflow || '');
  });
  expect(inlineStylesAfterRapid).toBe('|');
});

// ----------------------------------------------------------------
// 9. Selecting an object node updates grid rows
// ----------------------------------------------------------------
test('9. Selecting an object node updates the property grid', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();

  // Expand address first
  const addressRow = page.locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^address$/ }) });
  await addressRow.locator('.expander-box').click();

  // Click address row to select it
  await addressRow.click();

  // Grid should show address properties: street, city, geo
  const gridNames = page.locator('.grid-cell-name');
  const nameTexts = await gridNames.allTextContents();
  expect(nameTexts).toContain('street');
  expect(nameTexts).toContain('city');
  expect(nameTexts).toContain('geo');

  // Nested objects show "..."
  const gridValues = page.locator('.grid-cell-value');
  const valTexts = await gridValues.allTextContents();
  expect(valTexts).toContain('...');
  expect(valTexts).toContain('"123 Main St"');
});

// ----------------------------------------------------------------
// 10. Selecting a leaf shows parent's properties in grid
// ----------------------------------------------------------------
test('10. Selecting a leaf node shows parent properties in grid', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();

  // "name" leaf at depth 1 — click it
  const nameRow = page.locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^name : "John"$/ }) });
  await nameRow.click();

  // Grid should show root object properties (parent of name is root)
  const gridNames = page.locator('.grid-cell-name');
  const nameTexts = await gridNames.allTextContents();
  expect(nameTexts).toContain('name');
  expect(nameTexts).toContain('age');
  expect(nameTexts).toContain('active');
  expect(nameTexts).toContain('score');
});

// ----------------------------------------------------------------
// 11. Grid header click sorts asc/desc
// ----------------------------------------------------------------
test('11. Grid header click toggles sort asc/desc', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();

  // Root selected, so grid shows top-level keys
  // Default sort: name ascending — first item should be "active" (a comes before n)
  const firstCell = page.locator('.grid-cell-name').first();
  await expect(firstCell).toHaveText('active');

  // Sort arrow for Name should be visible (ascending ▲)
  await expect(page.locator('#sort-arrow-name')).toBeVisible();
  await expect(page.locator('#sort-arrow-name')).toHaveText('▲');

  // Click Name header to sort desc
  await page.locator('#grid-col-name').click();
  await expect(page.locator('#sort-arrow-name')).toHaveText('▼');
  const firstCellDesc = page.locator('.grid-cell-name').first();
  await expect(firstCellDesc).toHaveText('tags');

  // Click Value header
  await page.locator('#grid-col-value').click();
  await expect(page.locator('#sort-arrow-value')).toBeVisible();
  await expect(page.locator('#sort-arrow-name')).not.toBeVisible();
});

// ----------------------------------------------------------------
// 12. Search finds deep key, expands ancestors, Next/Prev cycles
// ----------------------------------------------------------------
test('12. Search finds deep key, expands ancestors, Next/Prev cycle with wrap', async ({ page }) => {
  await page.goto('/');
  await page.locator('#json-input').fill(SAMPLE_JSON);
  await page.locator('#tab-viewer').click();

  // Search for "lat"
  await page.locator('#search-input').fill('lat');
  await page.locator('#btn-search-go').click();

  // lat row should be visible (ancestors expanded)
  const latLabel = page.locator('.tree-label', { hasText: /^lat :/ });
  await expect(latLabel).toBeVisible();

  // lat row should be selected
  const latRow = page.locator('.tree-row', { has: latLabel });
  await expect(latRow).toHaveClass(/selected/);

  // Search for "a" — multiple matches
  await page.locator('#search-input').fill('a');
  await page.locator('#btn-search-go').click();

  // Next cycles forward
  const firstSelected = await page.locator('.tree-row.selected').first();
  await page.locator('#btn-search-next').click();
  // Some other row should be selected after next

  // Previous goes back — eventually wraps
  await page.locator('#btn-search-prev').click();
  // Should be back to first match without errors
  const selectedRows = page.locator('.tree-row.selected');
  await expect(selectedRows).toHaveCount(1);
});

// ----------------------------------------------------------------
// 13. Copy button: clipboard content equals textarea
// ----------------------------------------------------------------
test('13. Copy writes textarea content to clipboard', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto('/');

  const content = '{"test":123}';
  await page.locator('#json-input').fill(content);
  await page.locator('#btn-copy').click();

  const clipText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipText).toBe(content);

  // Status bar shows "Copied"
  await expect(page.locator('#status-text')).toHaveText('Copied');

  await context.close();
});

// ----------------------------------------------------------------
// 14. About dialog opens and closes
// ----------------------------------------------------------------
test('14. About dialog opens and closes with OK, X, and Escape', async ({ page }) => {
  await page.goto('/');

  // Open
  await page.locator('#btn-about').click();
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);
  await expect(page.locator('#modal-title')).toHaveText('About');
  await expect(page.locator('#modal-message')).toContainText('jsontree');

  // Close with OK
  await page.locator('#modal-ok-btn').click();
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);

  // Open again, close with X
  await page.locator('#btn-about').click();
  await page.locator('#modal-close-btn').click();
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);

  // Open again, close with Escape
  await page.locator('#btn-about').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);
});

// ----------------------------------------------------------------
// 15. Empty textarea + Viewer tab → no error, empty tree
// ----------------------------------------------------------------
test('15. Empty textarea with Viewer tab shows no error and empty tree', async ({ page }) => {
  await page.goto('/');
  // Ensure textarea is empty
  await expect(page.locator('#json-input')).toHaveValue('');

  await page.locator('#tab-viewer').click();

  // No error dialog
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);

  // Viewer panel active
  await expect(page.locator('#panel-viewer')).toHaveClass(/active/);

  // Empty tree
  const treeRows = page.locator('#tree-container .tree-row');
  await expect(treeRows).toHaveCount(0);
});
