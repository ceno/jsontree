/* jsontree — app.js
 *
 * One window, no modes-as-tabs: a unified toolbar with a search field that
 * works over the tree and in the source editor alike, and a status bar that is
 * the same height in every state. The tree keeps the previous release's layout.
 */
var __jsontreeMain = function () {
  'use strict';

  // ----------------------------------------------------------------
  // DOM refs
  // ----------------------------------------------------------------
  const appEl         = document.getElementById('app');
  const treeContainer = document.getElementById('tree-container');
  const treeScroll    = document.getElementById('tree-scroll');

  const btnCopy        = document.getElementById('btn-copy');
  const btnCopyPath    = document.getElementById('btn-copy-path');
  const btnExpandAll   = document.getElementById('btn-expand-all');
  const btnCollapseAll = document.getElementById('btn-collapse-all');
  const btnFormat      = document.getElementById('btn-format');
  const btnMinify      = document.getElementById('btn-minify');
  const btnEdit        = document.getElementById('btn-edit');
  const btnEditLabel   = document.getElementById('btn-edit-label');
  const btnTheme       = document.getElementById('btn-theme');

  const searchField = document.getElementById('search-field');
  const searchInput = document.getElementById('search-input');
  const searchCount = document.getElementById('search-count');
  const searchPrev  = document.getElementById('search-prev');
  const searchNext  = document.getElementById('search-next');
  const searchClear = document.getElementById('search-clear');

  const editWrap        = document.getElementById('edit-wrap');
  const editArea        = document.getElementById('edit-area');
  const editGutter      = document.getElementById('edit-gutter');
  const editGutterInner = document.getElementById('edit-gutter-inner');
  const editLineNumbers = document.getElementById('edit-line-numbers');
  const editCurrentLine   = document.getElementById('edit-current-line');
  const editCurrentNumber = document.getElementById('edit-current-number');
  const editMarks       = document.getElementById('edit-marks');
  const editHighlight   = document.getElementById('edit-highlight');

  const statusLeft = document.getElementById('status-left');
  const statusPath = document.getElementById('status-path');

  const EDIT_LINE_HEIGHT = 18;            // px; must track the editor's line-height in style.css
  const EDIT_OVERSCAN = 40;               // lines drawn beyond each edge of the editor
  const HIGHLIGHT_LIMIT = 100000;         // characters; more than this on screen is not coloured
  const PATH_HINT = '⌘F Search';

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let parsedData  = null;     // the parsed document, or null when empty
  let rawText     = '';       // pretty-printed source of parsedData
  let isEmpty     = true;
  let selectedRow = null;
  let hoverPath   = null;     // path under the pointer, if any
  let lastPath    = null;     // path shown in the status bar
  let statusTimer = null;

  let searchQuery   = '';     // what is being looked for, trimmed; '' when idle
  let searchRows    = [];     // over the tree: the rows that match, in order
  let searchOffsets = [];     // in the editor: where each match starts in the text
  let searchIndex   = -1;     // the current match, in whichever list is live

  // ----------------------------------------------------------------
  // JSON helpers
  // ----------------------------------------------------------------
  function getType(val) {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    return typeof val; // 'object', 'string', 'number', 'boolean'
  }

  function formatLeafValue(val) {
    if (typeof val === 'string') return '"' + val + '"';
    if (val === null) return 'null';
    return String(val);
  }

  function isContainerType(t) { return t === 'object' || t === 'array'; }

  function countNodes(val) {
    const t = getType(val);
    if (!isContainerType(t)) return 1;
    let n = 1;
    const entries = t === 'array' ? val : Object.keys(val).map(k => val[k]);
    for (const child of entries) n += countNodes(child);
    return n;
  }

  // results[1].author.orcid — the notation the status bar shows and copies.
  //
  // A key is only written with a dot when it cannot be confused for anything
  // else. Otherwise it is bracket-quoted, so a key literally called "a.b" is
  // ["a.b"] and stays distinct from a nested a -> b, and the empty key is [""]
  // rather than colliding with the root's own empty path.
  const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function joinPath(base, key, parentIsArray) {
    if (parentIsArray) return base + '[' + key + ']';
    if (PLAIN_KEY.test(key)) return base === '' ? key : base + '.' + key;
    return base + '[' + JSON.stringify(key) + ']';
  }

  // "6 keys", "1 item", "0 items" — what a container row says about its size.
  function describeCount(val, type) {
    const n = type === 'array' ? val.length : Object.keys(val).length;
    return n + (type === 'array' ? ' item' : ' key') + (n === 1 ? '' : 's');
  }

  function byteSize(str) { return new Blob([str]).size; }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ----------------------------------------------------------------
  // Parsing
  //
  // JSON.parse is the parser; it is correct and fast. It is not a reliable
  // source of *position*, though — V8 used to put "at position N" in the
  // message and newer versions do not, so a message-scraping regex silently
  // reports line 1 for a fault anywhere in the document. locateJsonError
  // therefore re-walks the text itself when (and only when) parsing failed.
  // ----------------------------------------------------------------
  function lineColOf(text, index) {
    const upTo = text.slice(0, index);
    const lines = upTo.split('\n');
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  }

  function locateJsonError(text) {
    let i = 0;
    const n = text.length;

    function fail(reason, at) {
      const e = new Error(reason);
      e.__at = at === undefined ? i : at;
      e.__reason = reason;
      throw e;
    }
    function ws() {
      while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
    }
    function word(w) {
      if (text.substr(i, w.length) === w) { i += w.length; return true; }
      return false;
    }
    function digits() {
      const from = i;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      return i - from;
    }
    function str() {
      const open = i;
      i++; // opening quote
      while (i < n) {
        const c = text[i];
        if (c === '\\') {
          const esc = text[i + 1];
          if (i + 1 >= n) fail('unterminated string', open);
          if ('"\\/bfnrt'.indexOf(esc) !== -1) { i += 2; continue; }
          if (esc === 'u') {
            for (let k = 2; k < 6; k++) {
              const h = text[i + k];
              if (h === undefined || !/[0-9a-fA-F]/.test(h)) {
                fail('bad \\u escape — four hex digits required', i);
              }
            }
            i += 6;
            continue;
          }
          // Shown verbatim: JSON.stringify would double the backslash and
          // report \\x for what the reader actually typed as \x.
          fail('unknown escape "\\' + (esc || '') + '"', i);
        }
        if (c === '"') { i++; return; }
        // JSON forbids raw control characters inside a string; they have to be
        // escaped. \n is the common one and reads as an unterminated string.
        if (c === '\n') fail('unterminated string', open);
        if (c < ' ') fail('unescaped control character in string', i);
        i++;
      }
      fail('unterminated string', open);
    }
    // Strict JSON numbers: no leading zeros, no trailing dot, no bare sign,
    // no empty exponent. JSON.parse rejects all of these, so the scanner must
    // too — otherwise it finds nothing wrong and we lose the position.
    function num() {
      if (text[i] === '-') {
        i++;
        if (i >= n) fail('expected a digit after "-"');
      }
      if (text[i] === '0') {
        i++;
        if (text[i] >= '0' && text[i] <= '9') fail('numbers may not have a leading zero', i);
      } else if (!digits()) {
        fail('expected a digit');
      }
      if (text[i] === '.') {
        i++;
        if (!digits()) fail('expected a digit after the decimal point');
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!digits()) fail('expected a digit in the exponent');
      }
    }
    function value() {
      ws();
      if (i >= n) fail('unexpected end of input');
      const c = text[i];
      if (c === '{') return object();
      if (c === '[') return array();
      if (c === '"') return str();
      if (c === '-' || (c >= '0' && c <= '9')) return num();
      if (word('true') || word('false') || word('null')) return;
      fail('unexpected ' + JSON.stringify(c));
    }
    function object() {
      i++; // {
      ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (i >= n) fail('unexpected end of input');
        if (text[i] !== '"') fail('expected a property name');
        str();
        ws();
        if (i >= n) fail('unexpected end of input');
        if (text[i] !== ':') fail('expected ":" after the property name');
        i++;
        value();
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail(i >= n ? 'unexpected end of input' : 'expected "," or "}"');
      }
    }
    function array() {
      i++; // [
      ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value();
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail(i >= n ? 'unexpected end of input' : 'expected "," or "]"');
      }
    }

    try {
      value();
      ws();
      if (i < n) fail('unexpected trailing content');
      // The scan found nothing wrong, so we cannot point at a position.
      return null;
    } catch (e) {
      if (e.__at === undefined) return null;
      // Do not clamp: when the input simply ran out, the position one past the
      // end is the honest answer, and clamping reports the previous line.
      const at = Math.min(e.__at, n);
      const lc = lineColOf(text, at);
      return { line: lc.line, col: lc.col, at: at, reason: e.__reason };
    }
  }

  function tryParse(text) {
    if (text.trim() === '') return { ok: true, data: null, trulyEmpty: true };
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (e) {
      const where = locateJsonError(text);
      if (where) {
        return {
          ok: false,
          line: where.line,
          at: where.at,
          message: 'Invalid JSON — line ' + where.line + ', column ' + where.col + ': ' + where.reason
        };
      }
      // The scanner agreed the text is well-formed but JSON.parse did not.
      // Fall back to the engine's own position — modern V8 appends
      // "(line N column M)", older builds only "at position N" — and keep the
      // message in our own shape so the status bar never changes format.
      const lc = positionFromMessage(text, e.message);
      return {
        ok: false,
        line: lc.line,
        at: lc.at,
        message: 'Invalid JSON — line ' + lc.line + ', column ' + lc.col + ': ' + tidyReason(e.message)
      };
    }
  }

  function positionFromMessage(text, message) {
    const lineCol = /\(line (\d+) column (\d+)\)/.exec(message);
    if (lineCol) {
      const line = +lineCol[1], col = +lineCol[2];
      return { line: line, col: col, at: indexOfLineCol(text, line, col) };
    }
    const pos = /position (\d+)/.exec(message);
    if (pos) {
      const at = Math.min(+pos[1], text.length);
      const lc = lineColOf(text, at);
      return { line: lc.line, col: lc.col, at: at };
    }
    return { line: 1, col: 1, at: 0 };
  }

  function indexOfLineCol(text, line, col) {
    let start = 0;
    for (let l = 1; l < line; l++) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) break;
      start = nl + 1;
    }
    return Math.min(start + col - 1, text.length);
  }

  function tidyReason(message) {
    return message
      .replace(/^JSON\.parse:\s*/, '')
      .replace(/\s*in JSON\b.*$/, '')
      .replace(/\s*at position \d+.*$/, '')
      .trim() || 'could not be parsed';
  }

  // ----------------------------------------------------------------
  // Status bar
  // ----------------------------------------------------------------
  function describeDocument() {
    if (isEmpty) return 'Empty';
    const size = formatBytes(byteSize(rawText));
    const found = describeSearch();
    if (found) return 'Valid JSON · ' + found + ' · ' + size;
    const n = countNodes(parsedData);
    return 'Valid JSON · ' + size + ' · ' + n + (n === 1 ? ' node' : ' nodes');
  }

  // While a search stands, its tally takes the place of the node or line
  // count: "2 of 5 matches for “city”".
  function describeSearch() {
    if (!searchQuery) return '';
    const total = searchTotal();
    return (total ? (searchIndex + 1) + ' of ' + total : 'No') +
           (total === 1 ? ' match' : ' matches') + ' for “' + searchQuery + '”';
  }

  // Re-derives both the text and its severity. describeEditBuffer() returns the
  // parse error for an invalid buffer, so the error class has to be re-applied
  // here — otherwise a transient ("Copied path") expires and brings the error
  // text back in neutral grey, reporting a broken document as fine.
  function restoreStatus() {
    const editing = appEl.classList.contains('editing');
    const text = editing ? describeEditBuffer() : describeDocument();
    statusLeft.textContent = text;
    statusLeft.classList.toggle('error', editing && isErrorText(text));
  }

  function isErrorText(text) { return text.indexOf('Invalid JSON') === 0; }

  function describeEditBuffer() {
    const text = editArea.value;
    const lines = text === '' ? 0 : text.split('\n').length;
    const res = tryParse(text);
    if (!res.ok) return res.message;
    const size = formatBytes(byteSize(text));
    const found = describeSearch();
    return (res.trulyEmpty ? 'Empty' : 'Valid JSON') + ' · ' +
           (found ? found + ' · ' + size : size + ' · ' + lines + ' lines');
  }

  function showStatus(msg) {
    statusLeft.classList.remove('error');
    statusLeft.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(restoreStatus, 1800);
  }

  function showError(msg) {
    if (statusTimer) clearTimeout(statusTimer);
    statusLeft.classList.add('error');
    statusLeft.textContent = msg;
  }

  function setPath(path) {
    lastPath = path;
    if (path === null) {
      statusPath.textContent = PATH_HINT;
      statusPath.className = 'hint';
      return;
    }
    statusPath.textContent = path === '' ? '(root)' : path;
    statusPath.className = 'has-path';
  }

  // Hover previews a path; leaving restores the selected one.
  function showHoverPath(path) {
    hoverPath = path;
    setPath(path);
  }

  function clearHoverPath() {
    hoverPath = null;
    setPath(selectedRow ? selectedRow._nodeData.path : null);
  }

  // What the user would mean by "this node": the selection if there is one,
  // otherwise whatever they are pointing at.
  function activePath() {
    if (selectedRow) return selectedRow._nodeData.path;
    return hoverPath;
  }

  statusPath.addEventListener('click', () => copyPath(lastPath));

  function copyPath(path) {
    if (path === null) { showStatus('No path'); return; }
    if (path === '') { showStatus('The root has no path'); return; }
    copyText(path);
    showStatus('Copied path');
  }

  // ----------------------------------------------------------------
  // Clipboard
  // ----------------------------------------------------------------
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
    ta.remove();
  }

  // ----------------------------------------------------------------
  // Tree building
  //
  // Rows sit on an 18px column grid: one column per level above the node,
  // then one for its own disclosure triangle. Each row also carries the node's path, which the
  // status bar reads and the Copy Path command copies, a glyph for its type,
  // and — on a container — a count of what it holds.
  //
  // `open` is the paths that stood open in the tree this one replaces, and
  // those are opened again. Without it the document is a new one, and starts
  // with only its root open.
  // ----------------------------------------------------------------
  function buildTree(data, open) {
    treeContainer.innerHTML = '';
    selectedRow = null;
    if (data === undefined) return;

    const rootEl = createNodeEl('JSON', data, 0, null, '');
    treeContainer.appendChild(rootEl);

    if (!open) { setExpanded(rootEl, true); return; }
    allNodes().forEach((nodeEl) => {
      if (open.has(nodeEl.firstChild._nodeData.path)) setExpanded(nodeEl, true);
    });
  }

  // The +/− glyph is a CSS-drawn triangle; these classes are the sole source
  // of truth for which way it points.
  function setExpanderGlyph(box, expanded) {
    box.classList.toggle('minus', expanded);
    box.classList.toggle('plus', !expanded);
  }

  // A row is `depth` pass-through columns, one under each ancestor's
  // triangle, and then a column for the node's own. The indent guides are not
  // the rows' to draw: each container's block of children draws one, in that
  // container's column, so it has to be told how deep the container is.
  function createNodeEl(key, value, depth, parentData, path) {
    const type = getType(value);
    const isContainer = isContainerType(type);

    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';

    const rowEl = document.createElement('div');
    rowEl.className = 'tree-row';
    rowEl.setAttribute('data-depth', depth);
    rowEl.setAttribute('data-path', path);

    for (let i = 0; i < depth; i++) {
      const col = document.createElement('span');
      col.className = 'tc tc-pass';
      rowEl.appendChild(col);
    }

    const elbowCol = document.createElement('span');
    elbowCol.className = depth === 0 ? 'tc tc-root' : 'tc tc-elbow';

    if (isContainer) {
      const box = document.createElement('span');
      box.className = 'expander-box';
      setExpanderGlyph(box, false);
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNode(nodeEl, box);
      });
      elbowCol.appendChild(box);
    }

    rowEl.appendChild(elbowCol);

    const iconEl = document.createElement('span');
    iconEl.className = 'tree-icon icon-' + type;
    // A boolean's icon is its value: a tick or a cross.
    if (type === 'boolean') iconEl.classList.add(value ? 'is-true' : 'is-false');
    rowEl.appendChild(iconEl);

    const labelEl = document.createElement('span');
    labelEl.className = 'tree-label';
    const labelText = isContainer ? key : key + ' : ' + formatLeafValue(value);
    labelEl.textContent = labelText;
    rowEl.appendChild(labelEl);

    if (isContainer) {
      // Beside the label rather than in it: search looks through the label,
      // and must not match "keys" on every object.
      const countEl = document.createElement('span');
      countEl.className = 'tree-count';
      countEl.textContent = describeCount(value, type);
      rowEl.appendChild(countEl);
    }

    rowEl._nodeData = {
      key: key,
      value: value,
      type: type,
      isContainer: isContainer,
      parentData: parentData,
      depth: depth,
      path: path,
      label: labelText        // what search looks through
    };

    rowEl.addEventListener('click', () => selectRow(rowEl));
    rowEl.addEventListener('mouseenter', () => showHoverPath(path));
    rowEl.addEventListener('mouseleave', clearHoverPath);

    if (isContainer) {
      rowEl.addEventListener('dblclick', () => {
        const box = rowEl.querySelector('.expander-box');
        if (box) toggleNode(nodeEl, box);
      });
    }

    nodeEl.appendChild(rowEl);

    if (isContainer) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children collapsed';
      childrenEl.style.setProperty('--depth', depth);

      const isArray = type === 'array';
      const entries = isArray
        ? value.map((v, idx) => [String(idx), v])
        : Object.entries(value);

      for (let idx = 0; idx < entries.length; idx++) {
        const pair = entries[idx];
        const childPath = joinPath(path, pair[0], isArray);
        childrenEl.appendChild(createNodeEl(pair[0], pair[1], depth + 1, value, childPath));
      }

      nodeEl.appendChild(childrenEl);
    }

    return nodeEl;
  }

  // ----------------------------------------------------------------
  // Expand / collapse, with the slide animation carried over
  // ----------------------------------------------------------------
  const nodeAnimMap = new WeakMap();
  const ANIM_DURATION = 250;

  // The stylesheet honours this for its own transitions; the expand/collapse
  // slide is driven here, so it has to ask as well.
  const reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function finishAnimInstantly(nodeEl) {
    const anim = nodeAnimMap.get(nodeEl);
    if (!anim) return;
    cancelAnimationFrame(anim.raf);
    const { expanding, childrenEl, inner, box } = anim;
    while (inner.firstChild) childrenEl.appendChild(inner.firstChild);
    inner.remove();
    childrenEl.style.overflow = '';
    childrenEl.style.height = '';
    childrenEl.classList.toggle('collapsed', !expanding);
    setExpanderGlyph(box, expanding);
    nodeAnimMap.delete(nodeEl);
  }

  function startAnim(nodeEl, box, expanding) {
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    if (!childrenEl) return;

    if (reducedMotion.matches) {
      setExpanded(nodeEl, expanding);
      return;
    }

    if (expanding) childrenEl.classList.remove('collapsed');

    const H = childrenEl.scrollHeight;
    if (H === 0) {
      if (!expanding) childrenEl.classList.add('collapsed');
      setExpanderGlyph(box, expanding);
      return;
    }

    // Children move into a wrapper so the container can be height-animated
    // without the rows themselves reflowing.
    const inner = document.createElement('div');
    while (childrenEl.firstChild) inner.appendChild(childrenEl.firstChild);
    childrenEl.appendChild(inner);
    childrenEl.style.overflow = 'hidden';
    childrenEl.style.height = (expanding ? 0 : H) + 'px';

    setExpanderGlyph(box, expanding);

    const start = performance.now();
    const anim = { raf: 0, expanding, childrenEl, inner, box };
    nodeAnimMap.set(nodeEl, anim);

    function step(now) {
      const t = Math.min(1, (now - start) / ANIM_DURATION);
      const e = easeOut(t);
      childrenEl.style.height = (expanding ? H * e : H * (1 - e)) + 'px';
      if (t < 1) {
        anim.raf = requestAnimationFrame(step);
      } else {
        finishAnimInstantly(nodeEl);
      }
    }
    anim.raf = requestAnimationFrame(step);
  }

  // Only the pointer comes through here, and it is resting on this row.
  function toggleNode(nodeEl, box) {
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    if (!childrenEl) return;
    if (nodeAnimMap.has(nodeEl)) return;   // mid-animation: ignore
    const expanding = childrenEl.classList.contains('collapsed');
    if (!expanding) holdTreeLength();
    startAnim(nodeEl, box, expanding);
  }

  // ----------------------------------------------------------------
  // Keeping a row under the pointer
  //
  // A container opens and closes below its own row, so the row has no reason
  // to move, and the pointer that pressed its triangle should still be on it
  // afterwards. Near the end of the document two things moved it anyway.
  // Closing a container there left the tree scrolled past its new end, so the
  // browser pulled the scroll position back and every row slid down. Its
  // scroll anchoring then remembered where the top row had been, and at the
  // next opening scrolled to put it back — and every row slid up.
  //
  // Anchoring is switched off in the stylesheet. The pull-back is headed off
  // here: before a container closes under the pointer the tree is given a
  // floor, a min-height that keeps it just long enough to stay scrolled where
  // it is. Rows opened later fill the floor, and it is lowered as the reader
  // scrolls back up, so the blank it leaves is never scrolled back into.
  // ----------------------------------------------------------------
  let treeFloor = 0;

  function setTreeFloor(px) {
    treeFloor = px;
    treeContainer.style.minHeight = px ? px + 'px' : '';
  }

  // How long the tree has to be to stay scrolled where it is. Scrolled to the
  // top it needs no floor. The height counted is the one with the horizontal
  // scrollbar in it: closing a container can take that scrollbar away, and
  // the rows it was covering then count as in view too.
  function treeLengthInUse() {
    const top = treeScroll.scrollTop;
    return top > 0 ? Math.ceil(top + treeScroll.offsetHeight) : 0;
  }

  function holdTreeLength() {
    setTreeFloor(treeLengthInUse());
  }

  function lowerTreeFloor() {
    if (treeFloor) setTreeFloor(Math.min(treeFloor, treeLengthInUse()));
  }

  // Opening or closing everything changes the tree above the rows in view as
  // well as below them. With anchoring off nothing else keeps the reader's
  // place, so the first row in view is put back where it was — if it is still
  // showing; closed away, there is no place left to keep.
  function keepingPlace(change) {
    const edge = treeScroll.getBoundingClientRect().top;
    const row = visibleRows().find(r => r.getBoundingClientRect().bottom > edge);
    const was = row && row.getBoundingClientRect().top;
    change();
    if (row && row.offsetParent !== null) {
      treeScroll.scrollTop += row.getBoundingClientRect().top - was;
    }
  }

  function setExpanded(nodeEl, expanded) {
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    if (!childrenEl) return;
    if (nodeAnimMap.has(nodeEl)) finishAnimInstantly(nodeEl);
    childrenEl.classList.toggle('collapsed', !expanded);
    const box = nodeEl.querySelector(':scope > .tree-row .expander-box');
    if (box) setExpanderGlyph(box, expanded);
  }

  function expandAncestors(rowEl) {
    let el = rowEl.parentElement;
    while (el && el !== treeContainer) {
      if (el.classList.contains('tree-children')) {
        const parentNode = el.parentElement;
        if (nodeAnimMap.has(parentNode)) finishAnimInstantly(parentNode);
        if (el.classList.contains('collapsed')) setExpanded(parentNode, true);
      }
      el = el.parentElement;
    }
  }

  function allNodes() {
    return Array.prototype.slice.call(treeContainer.querySelectorAll('.tree-node'));
  }

  // The path of every container standing open. Rows do not outlive a rebuild
  // of the tree; their paths do, which is how the new ones know to open.
  function expandedPaths() {
    const open = new Set();
    allNodes().forEach((nodeEl) => {
      // Mid-slide, a closing container has not been marked closed yet.
      if (nodeAnimMap.has(nodeEl)) finishAnimInstantly(nodeEl);
      const childrenEl = nodeEl.querySelector(':scope > .tree-children');
      if (childrenEl && !childrenEl.classList.contains('collapsed')) {
        open.add(nodeEl.firstChild._nodeData.path);
      }
    });
    return open;
  }

  function expandAll() {
    if (isEmpty) { showStatus('Nothing to expand'); return; }
    keepingPlace(() => allNodes().forEach(n => setExpanded(n, true)));
    showStatus('Expanded all');
  }

  function collapseAll() {
    if (isEmpty) { showStatus('Nothing to collapse'); return; }
    // A floor left standing would keep the tree scrolled into nothing at all.
    setTreeFloor(0);
    // Leave the root open, otherwise the window looks empty.
    keepingPlace(() => allNodes().forEach((n, idx) => setExpanded(n, idx === 0)));
    dropStaleHover();
    // The selection may now be inside a closed container; move it to the
    // nearest row still on screen rather than leaving it stranded.
    if (selectedRow && selectedRow.offsetParent === null) {
      const rows = visibleRows();
      if (rows.length) selectRow(rows[0]);
    }
    showStatus('Collapsed all');
  }

  // ----------------------------------------------------------------
  // Selection
  // ----------------------------------------------------------------
  function selectRow(rowEl) {
    if (selectedRow) selectedRow.classList.remove('selected');
    rowEl.classList.add('selected');
    selectedRow = rowEl;
    // Selecting always wins over a hover preview. Moving by keyboard fires no
    // mouseleave, so without this the bar keeps showing whatever the pointer
    // happens to be resting on while the selection walks away from it.
    hoverPath = null;
    setPath(rowEl._nodeData.path);
  }

  // A hovered row can be collapsed out of existence without a mouseleave.
  function dropStaleHover() {
    if (hoverPath !== null) {
      hoverPath = null;
      setPath(selectedRow ? selectedRow._nodeData.path : null);
    }
  }

  function visibleRows() {
    return Array.prototype.slice
      .call(treeContainer.querySelectorAll('.tree-row'))
      .filter(r => r.offsetParent !== null);
  }

  function moveSelection(delta) {
    const rows = visibleRows();
    if (!rows.length) return;
    let idx = selectedRow ? rows.indexOf(selectedRow) : -1;
    idx = idx === -1 ? (delta > 0 ? 0 : rows.length - 1) : idx + delta;
    if (idx < 0) idx = 0;
    if (idx >= rows.length) idx = rows.length - 1;
    selectRow(rows[idx]);
    rows[idx].scrollIntoView({ block: 'nearest' });
  }

  // → expands a closed container, otherwise steps into it.
  // ← collapses an open container, otherwise steps out to the parent.
  function moveHorizontal(forward) {
    if (!selectedRow) { moveSelection(1); return; }
    const nodeEl = selectedRow.parentElement;
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    const collapsed = childrenEl && childrenEl.classList.contains('collapsed');

    if (forward) {
      if (childrenEl && collapsed) { setExpanded(nodeEl, true); return; }
      moveSelection(1);
      return;
    }
    if (childrenEl && !collapsed) { setExpanded(nodeEl, false); return; }
    const parentChildren = nodeEl.parentElement;
    if (parentChildren && parentChildren.classList.contains('tree-children')) {
      const parentRow = parentChildren.parentElement.querySelector(':scope > .tree-row');
      if (parentRow) {
        selectRow(parentRow);
        parentRow.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  // ----------------------------------------------------------------
  // Search
  //
  // One field, always in the toolbar, for both views. Over the tree it finds
  // rows: every row whose label holds the query is tinted, and the current
  // one is selected. In the editor it finds text: every occurrence is marked,
  // the current one more strongly. Either way it counts them and steps
  // through them, and the query stands when the view changes.
  // ----------------------------------------------------------------
  function allRows() {
    return Array.prototype.slice.call(treeContainer.querySelectorAll('.tree-row'));
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Case is ignored by the expression rather than by lowercasing both sides:
  // lowercasing can change a string's length, which would shift every offset
  // after it. Matched this way a hit is always as long as the query.
  function searchPattern(flags) {
    return new RegExp(escapeRegExp(searchQuery), flags);
  }

  function searchTotal() {
    return appEl.classList.contains('editing') ? searchOffsets.length : searchRows.length;
  }

  function findInTree() {
    const re = searchQuery ? searchPattern('i') : null;
    searchRows = [];
    allRows().forEach((row) => {
      const hit = !!re && re.test(row._nodeData.label);
      row.classList.toggle('search-match', hit);
      if (hit) searchRows.push(row);
    });
  }

  function findInText() {
    searchOffsets = [];
    if (!searchQuery) return;
    const re = searchPattern('gi');
    let m;
    while ((m = re.exec(editText)) !== null) searchOffsets.push(m.index);
  }

  // Looks again in whichever view is showing. `jump` starts over at the first
  // match; otherwise the current match keeps its place in the list, which is
  // what typing in the editor under a standing query wants.
  function syncSearch(jump) {
    if (appEl.classList.contains('editing')) findInText();
    else findInTree();

    const total = searchTotal();
    if (total === 0) searchIndex = -1;
    else if (jump) searchIndex = 0;
    else searchIndex = Math.min(Math.max(searchIndex, 0), total - 1);
    showSearchCount();
  }

  function showSearchCount() {
    const total = searchTotal();
    searchCount.textContent = searchQuery ? (searchIndex + 1) + '/' + total : '';
    searchPrev.disabled = total === 0;
    searchNext.disabled = total === 0;
  }

  // The query or the view has changed: search afresh and go to the first match.
  function runSearch() {
    searchQuery = searchInput.value.trim();
    searchField.classList.toggle('has-value', searchInput.value !== '');
    syncSearch(true);
    // Going to a match draws it. With none to go to, the editor still has the
    // last query's marks to take away.
    if (searchIndex >= 0) revealMatch();
    else if (appEl.classList.contains('editing')) placeEditLines(true);
    restoreStatus();
  }

  function stepSearch(delta) {
    const total = searchTotal();
    if (!total) return;
    searchIndex = ((searchIndex + delta) % total + total) % total;
    showSearchCount();
    revealMatch();
    restoreStatus();
  }

  function revealMatch() {
    if (appEl.classList.contains('editing')) {
      revealTextMatch(searchOffsets[searchIndex]);
      return;
    }
    const row = searchRows[searchIndex];
    expandAncestors(row);
    selectRow(row);
    row.scrollIntoView({ block: 'center' });
  }

  function clearSearch() {
    searchInput.value = '';
    runSearch();
  }

  // Escape in the field: the search is over, and the keyboard goes back to
  // what was being searched. In the editor that means the caret, left on the
  // match that was current, selected — ready to be typed over or copied.
  function leaveSearch() {
    const editing = appEl.classList.contains('editing');
    const at = editing && searchIndex >= 0 ? searchOffsets[searchIndex] : -1;
    const length = searchQuery.length;
    clearSearch();
    searchInput.blur();
    if (!editing) return;
    // Taking the focus scrolls a textarea to its caret, which is still where
    // it was before the search; the match is what should stay in view.
    const top = editArea.scrollTop;
    const left = editArea.scrollLeft;
    if (at >= 0) editArea.setSelectionRange(at, at + length);
    editArea.focus();
    editArea.scrollTop = top;
    editArea.scrollLeft = left;
    placeEditLines(false);
  }

  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      stepSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      leaveSearch();
    }
  });
  searchNext.addEventListener('click', () => stepSearch(1));
  searchPrev.addEventListener('click', () => stepSearch(-1));
  searchClear.addEventListener('click', () => { clearSearch(); searchInput.focus(); });

  // Pressing anywhere on the field that is not the input — the magnifier, the
  // padding, a chevron — must not take the focus away from the input: where
  // the field has folded down to its magnifier it is only open while focused,
  // and would shut under the pointer. Pressing its bare parts opens it.
  searchField.addEventListener('mousedown', (e) => {
    if (e.target === searchInput) return;
    e.preventDefault();
    if (!e.target.closest('button')) searchInput.focus();
  });

  // ----------------------------------------------------------------
  // Document loading
  // ----------------------------------------------------------------
  function loadParsed(data, opts) {
    const trulyEmpty = !!(opts && opts.trulyEmpty);
    parsedData = data;
    isEmpty = trulyEmpty;
    rawText = trulyEmpty ? '' : JSON.stringify(data, null, 2);

    appEl.classList.toggle('empty', trulyEmpty);
    // The floor was for the pointer's sake in the tree these rows replace.
    setTreeFloor(0);
    if (trulyEmpty) {
      treeContainer.innerHTML = '';
      selectedRow = null;
    } else {
      buildTree(data, opts && opts.open);
      // Nothing is selected on load: the root's "selection" would paint a bar
      // across the top conveying nothing, and the status bar is more useful
      // showing the ⌘F hint until the reader picks a node.
    }
    // These are new rows. A search left standing — from the editor, say — is
    // run against them, which selects its first match.
    runSearch();
    setPath(selectedRow ? selectedRow._nodeData.path : null);
    restoreStatus();
  }

  // ----------------------------------------------------------------
  // Source editor
  // ----------------------------------------------------------------
  // `text` overrides the current document — used when something unparseable
  // arrives and the only useful thing to do is show it to the reader.
  function enterEdit(text) {
    editArea.value = text === undefined ? rawText : text;
    appEl.classList.add('editing');
    labelModeSwitch();
    editArea.focus();
    // focus() leaves the caret at the end, which scrolls a long document out
    // of view; start at the top where the reader expects to be. This has to
    // come after the value is assigned — setting .value resets the caret.
    editArea.setSelectionRange(0, 0);
    editArea.scrollTop = 0;
    editArea.scrollLeft = 0;
    validateEditBuffer();
    // A search left standing over the tree now looks through the text.
    if (searchQuery) runSearch();
  }

  // Leaving requires a document we can render; the status bar already says
  // what is wrong, so refuse rather than silently discarding the edit.
  function exitEdit() {
    const res = refreshEditor();
    if (!res.ok) {
      showError(res.message);
      return false;
    }
    closeEditor();
    // The tree that was left is still there behind the editor, and is about
    // to be rebuilt from the text. What was open in it stays open, edited or
    // not; an empty document had no tree to remember.
    const open = isEmpty ? null : expandedPaths();
    loadParsed(res.data, { trulyEmpty: !!res.trulyEmpty, open: open });
    return true;
  }

  // Puts the tree back in the content area. On its own this discards whatever
  // is in the textarea, so callers load a document straight afterwards.
  function closeEditor() {
    appEl.classList.remove('editing');
    labelModeSwitch();
    editArea.blur();
  }

  // The one button moves between the tree and the editor, and it is the only
  // way back out of the editor — so it names the view it leads to, not the
  // one you are in.
  function labelModeSwitch() {
    const editing = appEl.classList.contains('editing');
    btnEditLabel.textContent = editing ? 'View' : 'Edit';
    btnEdit.title = editing ? 'View the tree' : 'Edit the source';
  }

  // ----------------------------------------------------------------
  // Drawing the editor
  //
  // The line numbers, the coloured copy of the text, the search marks and the
  // error marker are all derived from the textarea's text — and only for the
  // lines on screen, plus a margin either side. Redrawing a whole document on every keystroke
  // costs more than a tenth of a second at a few hundred kilobytes; a
  // window of it costs the same whatever the document's size.
  // ----------------------------------------------------------------
  let editText = '';           // the textarea's text as of the last refresh
  let editLineStarts = [0];    // offset at which each line begins
  let editFault = null;        // the failed tryParse result, when invalid
  let drawnFirst = 0;          // lines currently drawn, inclusive…
  let drawnLast = -1;          // …and none yet
  let plainMatch = null;       // where the current match was found on text too long to mark

  function indexLines(text) {
    const starts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    return starts;
  }

  // A lexer, not the parser: it colours whatever is there, valid or not, so
  // one typo does not strip the colour from everything after it. A JSON
  // string cannot span lines, so an unterminated one ends at the newline —
  // which is also what lets any run of whole lines be coloured on its own.
  const TOKEN = /"(?:[^"\\\n]|\\.)*"?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);
  }

  // A string is a key when the next thing after it is a colon.
  function isKeyAt(text, end) {
    let i = end;
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
    return text[i] === ':';
  }

  function colourJson(text) {
    let html = '';
    let done = 0;
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text)) !== null) {
      const tok = m[0];
      const end = m.index + tok.length;
      const c = tok[0];
      let cls;
      if (c === '"') {
        // Keys stay in the default ink, so they need no element of their own.
        if (isKeyAt(text, end)) continue;
        cls = 'tok-str';
      } else if (c === 't' || c === 'f') {
        cls = 'tok-bool';
      } else if (c === 'n') {
        cls = 'tok-null';
      } else {
        cls = 'tok-num';
      }
      html += escapeHtml(text.slice(done, m.index)) +
              '<span class="' + cls + '">' + escapeHtml(tok) + '</span>';
      done = end;
    }
    return html + escapeHtml(text.slice(done));
  }

  // `faultAt` is where the JSON went wrong, as an offset into `text`, or -1.
  // From there to the end of its line is underlined and left uncoloured.
  function colourWithFault(text, faultAt) {
    if (faultAt < 0 || faultAt > text.length) return colourJson(text);
    let eol = text.indexOf('\n', faultAt);
    if (eol === -1) eol = text.length;
    return colourJson(text.slice(0, faultAt)) +
           '<span class="tok-error">' + escapeHtml(text.slice(faultAt, eol)) + '</span>' +
           colourJson(text.slice(eol));
  }

  // Index of the first entry of a sorted array that is not below `value`.
  function lowerBound(sorted, value) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function lineOfOffset(at) {
    return lowerBound(editLineStarts, at + 1) - 1;
  }

  // A third copy of the text from `start` to `end`, nothing of it showing but
  // the ground behind each match. A match never crosses a line break — the
  // query has none in it — so whole lines can be marked on their own.
  function markMatches(start, end) {
    const length = searchQuery.length;
    let i = lowerBound(searchOffsets, start);
    if (i === searchOffsets.length || searchOffsets[i] + length > end) return '';

    let html = '';
    let done = start;
    for (; i < searchOffsets.length && searchOffsets[i] + length <= end; i++) {
      const at = searchOffsets[i];
      html += escapeHtml(editText.slice(done, at)) +
              (i === searchIndex ? '<mark class="current">' : '<mark>') +
              escapeHtml(editText.slice(at, at + length)) + '</mark>';
      done = at + length;
    }
    return html + escapeHtml(editText.slice(done, end));
  }

  // How wide a short run of text is when the editor draws it.
  function measureEditText(text) {
    const probe = document.createElement('span');
    probe.className = 'edit-probe';
    probe.textContent = text;
    editMarks.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }

  // Which character of the textarea's text the caret would land before, for a
  // point on the page — or null where the browser cannot say.
  function caretAtPoint(x, y) {
    if (typeof document.caretPositionFromPoint !== 'function') return null;
    const caret = document.caretPositionFromPoint(x, y);
    return caret && caret.offsetNode === editArea ? caret.offset : null;
  }

  // Text too long to colour is too long to mark by drawing it again, so the
  // current match alone is shown there, as a box. Where to put it cannot be
  // measured from outside: lay a copy of a very long line out elsewhere and,
  // once it holds a few thousand runs in a second font, it comes out tens of
  // pixels away from where the textarea has it. So the textarea is asked, by
  // hit-testing it — sliding the text until the match is under the middle of
  // the editor, then finding where along that row the caret stops landing
  // before the match's first character. That costs a few milliseconds
  // whatever the line's length.
  function locatePlainMatch(at, line, style) {
    plainMatch = null;
    const end = at + searchQuery.length;
    const rect = editArea.getBoundingClientRect();
    const margin = parseFloat(style.paddingLeft);
    const y = rect.top + parseFloat(style.paddingTop) +
              line * EDIT_LINE_HEIGHT - editArea.scrollTop + EDIT_LINE_HEIGHT / 2;
    const x0 = rect.left;
    const x1 = rect.left + editArea.clientWidth;

    if (caretAtPoint(x0 + margin, y) === null) {
      // No hit-testing here: go to roughly the right place, and mark nothing
      // rather than mark the wrong text.
      const along = measureEditText(editText.slice(editLineStarts[line], at));
      editArea.scrollLeft = Math.max(0, along - editArea.clientWidth / 2);
      return;
    }

    // A match already in view is left where it is.
    if (caretAtPoint(x0 + margin, y) > at || caretAtPoint(x1 - margin, y) < end) {
      const mid = (x0 + x1) / 2;
      let lo = 0;
      let hi = editArea.scrollWidth - editArea.clientWidth;
      editArea.scrollLeft = 0;
      if (caretAtPoint(mid, y) >= at) hi = 0;
      while (hi - lo > 1) {
        const scroll = Math.floor((lo + hi) / 2);
        editArea.scrollLeft = scroll;
        if (caretAtPoint(mid, y) < at) lo = scroll;
        else hi = scroll;
      }
      editArea.scrollLeft = hi;
    }

    // The caret starts landing after the match's first character half-way
    // across it.
    let before = x0;
    let after = x1;
    while (after - before > 0.25) {
      const x = (before + after) / 2;
      if (caretAtPoint(x, y) <= at) before = x;
      else after = x;
    }
    const first = String.fromCodePoint(editText.codePointAt(at));
    plainMatch = {
      at: at,
      // The box is placed relative to where the text was scrolled to when it
      // was found, so that the sum never involves the line's full length —
      // millions of pixels, on which a transform is only good to the pixel.
      scrollLeft: editArea.scrollLeft,
      left: after - measureEditText(first) / 2 - rect.left,
      width: measureEditText(editText.slice(at, end))
    };
  }

  function boxPlainMatch(first, last) {
    if (!plainMatch || searchIndex < 0 || searchOffsets[searchIndex] !== plainMatch.at) return;
    const line = lineOfOffset(plainMatch.at);
    if (line < first || line > last) return;
    const box = document.createElement('mark');
    box.className = 'current boxed';
    box.style.left = plainMatch.left + 'px';
    box.style.top = (parseFloat(getComputedStyle(editMarks).paddingTop) + (line - first) * EDIT_LINE_HEIGHT) + 'px';
    box.style.width = plainMatch.width + 'px';
    editMarks.appendChild(box);
  }

  function drawEditLines(first, last) {
    drawnFirst = first;
    drawnLast = last;

    let numbers = String(first + 1);
    for (let n = first + 2; n <= last + 1; n++) numbers += '\n' + n;
    editLineNumbers.textContent = numbers;

    const start = editLineStarts[first];
    const end = last + 1 < editLineStarts.length ? editLineStarts[last + 1] - 1 : editText.length;
    // Too much on screen at once to colour — one enormous line, in practice.
    // The textarea shows its own text instead.
    const plain = end - start > HIGHLIGHT_LIMIT;
    editWrap.classList.toggle('plain', plain);
    if (plain) {
      editHighlight.textContent = '';
      editMarks.textContent = '';
      boxPlainMatch(first, last);
    } else {
      editHighlight.innerHTML = colourWithFault(
        editText.slice(start, end), editFault ? editFault.at - start : -1);
      editMarks.innerHTML = markMatches(start, end);
    }

    // The marker lies over the offending line's number, repeating it in red.
    const old = editGutterInner.querySelector('.edit-error-marker');
    if (old) old.remove();
    const faultLine = editFault ? editFault.line - 1 : -1;
    if (faultLine >= first && faultLine <= last) {
      const marker = document.createElement('div');
      marker.className = 'edit-error-marker';
      marker.textContent = faultLine + 1;
      marker.style.top = ((faultLine - first) * EDIT_LINE_HEIGHT) + 'px';
      editGutterInner.appendChild(marker);
    }
  }

  // The caret's line, as in any code editor: a band behind the text and the
  // line's number in full ink. While text is selected the band is dropped —
  // it would only muddy the selection — and the number alone says where the
  // caret is.
  function placeCaretLine() {
    const backward = editArea.selectionDirection === 'backward';
    const line = lineOfOffset(backward ? editArea.selectionStart : editArea.selectionEnd);
    editCurrentLine.hidden = editArea.selectionStart !== editArea.selectionEnd;
    editCurrentLine.style.transform =
      'translateY(' + (line * EDIT_LINE_HEIGHT - editArea.scrollTop) + 'px)';

    const drawn = line >= drawnFirst && line <= drawnLast;
    editCurrentNumber.hidden = !drawn;
    if (!drawn) return;
    editCurrentNumber.textContent = line + 1;
    editCurrentNumber.style.top = ((line - drawnFirst) * EDIT_LINE_HEIGHT) + 'px';
  }

  // Neither the gutter nor the copies of the text scroll: they are slid to
  // wherever the textarea is, and redrawn when it has moved past what was
  // drawn. `redraw` forces that, for when the text or the search has changed.
  function placeEditLines(redraw) {
    const top = editArea.scrollTop;
    const count = editLineStarts.length;
    const firstSeen = Math.min(count - 1, Math.floor(top / EDIT_LINE_HEIGHT));
    const lastSeen = Math.min(count - 1, Math.floor((top + editArea.clientHeight) / EDIT_LINE_HEIGHT));
    if (redraw || firstSeen < drawnFirst || lastSeen > drawnLast) {
      drawEditLines(Math.max(0, firstSeen - EDIT_OVERSCAN), Math.min(count - 1, lastSeen + EDIT_OVERSCAN));
    }
    const dy = drawnFirst * EDIT_LINE_HEIGHT - top;
    editGutterInner.style.transform = 'translateY(' + dy + 'px)';
    const left = editArea.scrollLeft;
    editHighlight.style.transform = 'translate(' + (-left) + 'px, ' + dy + 'px)';
    // A box on text too long to mark is placed from where the text was
    // scrolled to when the match was found, not from the start of its line.
    const boxed = editMarks.querySelector('mark.boxed');
    editMarks.style.transform =
      'translate(' + ((boxed && plainMatch ? plainMatch.scrollLeft : 0) - left) + 'px, ' + dy + 'px)';
    placeCaretLine();
  }

  // Brings a match in the text into view and draws it as the current one. A
  // match already on screen is left where it is; one that is not is centred.
  function revealTextMatch(at) {
    const style = getComputedStyle(editArea);
    const line = lineOfOffset(at);
    const top = parseFloat(style.paddingTop) + line * EDIT_LINE_HEIGHT;
    if (top < editArea.scrollTop ||
        top + EDIT_LINE_HEIGHT > editArea.scrollTop + editArea.clientHeight) {
      editArea.scrollTop = Math.max(0, top - (editArea.clientHeight - EDIT_LINE_HEIGHT) / 2);
    }
    placeEditLines(true);
    if (editWrap.classList.contains('plain')) {
      locatePlainMatch(at, line, style);
      placeEditLines(true);
      return;
    }

    const mark = editMarks.querySelector('mark.current');
    if (!mark) return;
    const margin = parseFloat(style.paddingLeft);
    if (mark.offsetLeft < editArea.scrollLeft + margin ||
        mark.offsetLeft + mark.offsetWidth > editArea.scrollLeft + editArea.clientWidth - margin) {
      editArea.scrollLeft = Math.max(0, mark.offsetLeft - editArea.clientWidth / 2);
      placeEditLines(false);
    }
  }

  // Anything that changes the textarea's text without the reader typing it has
  // to come through here afterwards, or the page keeps showing the old text.
  function refreshEditor() {
    editText = editArea.value;
    const res = tryParse(editText);
    editFault = res.ok ? null : res;
    editLineStarts = indexLines(editText);
    plainMatch = null;
    // The gutter is as wide as the last line's number, not the widest drawn.
    editGutter.style.setProperty('--digits', String(editLineStarts.length).length);
    // The matches of a standing search have moved, or come and gone.
    syncSearch(false);
    placeEditLines(true);
    return res;
  }

  function validateEditBuffer() {
    const res = refreshEditor();
    if (res.ok) restoreStatus();
    else showError(res.message);
  }

  editArea.addEventListener('input', validateEditBuffer);
  editArea.addEventListener('scroll', () => placeEditLines(false));
  // The caret moves without the text or the scroll position changing.
  document.addEventListener('selectionchange', () => {
    if (appEl.classList.contains('editing')) placeCaretLine();
  });
  // A taller window shows lines that were never drawn.
  window.addEventListener('resize', () => {
    if (appEl.classList.contains('editing')) placeEditLines(false);
    lowerTreeFloor();
  });
  // Scrolled back up, or in a shorter window, less of the floor is in use.
  treeScroll.addEventListener('scroll', lowerTreeFloor);

  btnEdit.addEventListener('click', () => {
    if (appEl.classList.contains('editing')) exitEdit();
    else enterEdit();
  });

  // ----------------------------------------------------------------
  // Commands
  // ----------------------------------------------------------------
  // Format and Minify rewrite the text in the editor and nothing else: neither
  // touches the clipboard. They exist only in the editor — over the tree there
  // is no text to rewrite.
  function rewriteSource(indent, done, nothing) {
    const res = tryParse(editArea.value);
    if (!res.ok) { showError(res.message); return; }
    if (res.trulyEmpty) { showStatus(nothing); return; }
    editArea.value = JSON.stringify(res.data, null, indent);
    refreshEditor();
    showStatus(done);
  }

  function doFormat() { rewriteSource(2, 'Formatted', 'Nothing to format'); }
  function doMinify() { rewriteSource(0, 'Minified', 'Nothing to minify'); }

  // Copy takes the selected node, all of it: an array comes out as an array
  // with everything in it, a leaf as its value. With nothing selected, or the
  // root, that is the whole document. What lands on the clipboard is always
  // JSON. The tree's own action — the editor copies with the keyboard.
  function doCopy() {
    if (isEmpty) { showStatus('Nothing to copy'); return; }
    const whole = !selectedRow || selectedRow._nodeData.path === '';
    copyText(whole ? rawText : JSON.stringify(selectedRow._nodeData.value, null, 2));
    showStatus(whole ? 'Copied document' : 'Copied value');
  }

  function doCopyPath() { copyPath(activePath()); }

  btnCopy.addEventListener('click', doCopy);
  btnCopyPath.addEventListener('click', doCopyPath);
  btnExpandAll.addEventListener('click', expandAll);
  btnCollapseAll.addEventListener('click', collapseAll);
  btnFormat.addEventListener('click', doFormat);
  btnMinify.addEventListener('click', doMinify);

  // ----------------------------------------------------------------
  // Appearance
  //
  // The stylesheet follows the system unless <html> carries data-theme, so
  // switching is a matter of setting it. Choosing what the system would show
  // anyway is choosing to follow it again, so then the attribute is dropped
  // rather than kept — otherwise one press would pin the app for good.
  // ----------------------------------------------------------------
  const THEME_KEY = 'jsontree-theme';     // index.html reads it before first paint
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  // The website remembers the choice. The extension does not: in a page it
  // took over, localStorage belongs to the site that served the document, and
  // the extension keeps nothing of its own (see PRIVACY.md).
  const remembersTheme = !window.__JSONTREE_DEFER__;

  function toggleTheme() {
    const root = document.documentElement;
    const system = systemDark.matches ? 'dark' : 'light';
    const forced = root.dataset.theme;
    const shown = forced === 'dark' || forced === 'light' ? forced : system;
    const next = shown === 'dark' ? 'light' : 'dark';

    if (next === system) delete root.dataset.theme;
    else root.dataset.theme = next;

    if (!remembersTheme) return;
    try {
      if (next === system) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch (e) { /* storage is off; the choice lasts for this page */ }
  }

  btnTheme.addEventListener('click', toggleTheme);

  // ----------------------------------------------------------------
  // Keyboard
  // ----------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && !e.altKey && key === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (mod && !e.altKey && key === 'g') {
      if (searchQuery) { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
      return;
    }
    if (mod && e.altKey && key === 'c') { e.preventDefault(); doCopyPath(); return; }
    if (mod && e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); collapseAll(); return; }
    if (mod && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); expandAll(); return; }

    // Escape in the search field is the field's own business. From anywhere
    // else it calls off a search left standing, and moves nothing.
    if (e.key === 'Escape') {
      if (searchInput.value !== '') { e.preventDefault(); clearSearch(); }
      return;
    }

    // Arrow navigation belongs to the tree, not to a focused text field.
    const typing = document.activeElement === searchInput ||
                   document.activeElement === editArea;
    if (typing || mod || appEl.classList.contains('editing')) return;

    if (e.key === 'ArrowDown')  { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveHorizontal(true); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveHorizontal(false); }
  });

  // ----------------------------------------------------------------
  // External API — used by the Chrome extension to hand us the document
  // it took over.
  // ----------------------------------------------------------------
  window.jsontree = {
    load: function (text) {
      const res = tryParse(text);
      // Unparseable: show the source so the problem is visible and fixable
      // rather than leaving a blank window.
      if (!res.ok) { enterEdit(text); return; }
      // A document handed to us is there to be read, so it goes straight to
      // the tree — even though the app was waiting in the editor.
      closeEditor();
      loadParsed(res.data, { trulyEmpty: !!res.trulyEmpty });
    }
  };

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  loadParsed(null, { trulyEmpty: true });
  // With no document there is nothing to read and one thing to do: put some
  // JSON in. So an empty app opens in the editor, caret ready for a paste. The
  // extension follows this with jsontree.load(), which goes to the tree.
  enterEdit();
};

// The Chrome extension sets __JSONTREE_DEFER__ before this file runs: it has to
// build the app's DOM itself (the page it takes over has none) before we bind to
// it, so it calls __jsontreeMain() when the DOM is ready. In index.html the
// script tag sits at the end of <body>, so we just run.
if (typeof window !== 'undefined' && window.__JSONTREE_DEFER__) {
  window.__jsontreeMain = __jsontreeMain;
} else {
  __jsontreeMain();
}
