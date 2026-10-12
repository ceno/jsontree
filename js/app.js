/* jsontree — app.js
 *
 * One window, no modes-as-tabs: a unified toolbar, a find bar summoned with
 * ⌘F, a command palette on ⌘K, and a status bar that is the same height in
 * every state. The tree itself is unchanged from the previous release.
 */
var __jsontreeMain = function () {
  'use strict';

  // ----------------------------------------------------------------
  // DOM refs
  // ----------------------------------------------------------------
  const appEl         = document.getElementById('app');
  const treeContainer = document.getElementById('tree-container');
  const treeScroll    = document.getElementById('tree-scroll');

  const btnPaste   = document.getElementById('btn-paste');
  const btnCopy    = document.getElementById('btn-copy');
  const btnFormat  = document.getElementById('btn-format');
  const btnMinify  = document.getElementById('btn-minify');
  const btnEdit    = document.getElementById('btn-edit');
  const btnFindOpen    = document.getElementById('btn-find-open');
  const btnPaletteOpen = document.getElementById('btn-palette-open');

  const findbar   = document.getElementById('findbar');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');
  const findPrev  = document.getElementById('find-prev');
  const findNext  = document.getElementById('find-next');
  const findDone  = document.getElementById('find-done');

  const editWrap        = document.getElementById('edit-wrap');
  const editArea        = document.getElementById('edit-area');
  const editGutterInner = document.getElementById('edit-gutter-inner');

  const statusLeft = document.getElementById('status-left');
  const statusPath = document.getElementById('status-path');

  const paletteOverlay = document.getElementById('palette-overlay');
  const paletteInput   = document.getElementById('palette-input');
  const paletteList    = document.getElementById('palette-list');

  const EDIT_LINE_HEIGHT = 12.5 * 1.85;   // must track #edit-area in style.css
  const PATH_HINT = '⌘K Commands · ⌘F Find';

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

  let findOpen   = false;
  let findMarks  = [];        // every <mark> in document order
  let findIndex  = -1;

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
  function joinPath(base, key, parentIsArray) {
    if (parentIsArray) return base + '[' + key + ']';
    if (base === '') return key;
    return base + '.' + key;
  }

  function byteSize(str) { return new Blob([str]).size; }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
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
    function str() {
      const open = i;
      i++; // opening quote
      while (i < n) {
        const c = text[i];
        if (c === '\\') {
          i++;
          if (i >= n) fail('unterminated string', open);
          i++;
          continue;
        }
        if (c === '"') { i++; return; }
        if (c === '\n') fail('unterminated string', open);
        i++;
      }
      fail('unterminated string', open);
    }
    function num() {
      const start = i;
      if (text[i] === '-') i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      if (text[i] === '.') {
        i++;
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
      if (i === start) fail('expected a number');
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
        if (text[i] !== '"') fail('expected a property name');
        str();
        ws();
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
      const lc = lineColOf(text, Math.min(e.__at, Math.max(0, n - 1)));
      return { line: lc.line, col: lc.col, reason: e.__reason };
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
          message: 'Invalid JSON — line ' + where.line + ', column ' + where.col + ': ' + where.reason
        };
      }
      return { ok: false, line: 1, message: 'Invalid JSON — ' + e.message };
    }
  }

  // ----------------------------------------------------------------
  // Status bar
  // ----------------------------------------------------------------
  function describeDocument() {
    if (isEmpty) return 'Empty';
    return 'Valid JSON · ' + formatBytes(byteSize(rawText)) + ' · ' +
           countNodes(parsedData) + ' nodes';
  }

  function restoreStatus() {
    statusLeft.classList.remove('error');
    statusLeft.textContent = appEl.classList.contains('editing')
      ? describeEditBuffer()
      : describeDocument();
  }

  function describeEditBuffer() {
    const text = editArea.value;
    const lines = text === '' ? 0 : text.split('\n').length;
    const res = tryParse(text);
    if (!res.ok) return res.message;
    return (res.trulyEmpty ? 'Empty' : 'Valid JSON') + ' · ' +
           formatBytes(byteSize(text)) + ' · ' + lines + ' lines';
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

  statusPath.addEventListener('click', () => {
    if (lastPath === null) return;
    copyText(lastPath);
    showStatus('Copied path');
  });

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
  // Unchanged from the previous release: same 18px column grid, the same
  // ancestorLineMask bookkeeping for indent guides, the same disclosure
  // triangle. The only addition is the node's path, which the status bar
  // reads and the Copy Path command copies.
  // ----------------------------------------------------------------
  function buildTree(data) {
    treeContainer.innerHTML = '';
    selectedRow = null;
    if (data === undefined) return;

    const rootEl = createNodeEl('JSON', data, 0, null, [], true, '');
    treeContainer.appendChild(rootEl);

    const rootChildren = rootEl.querySelector('.tree-children');
    if (rootChildren) {
      rootChildren.classList.remove('collapsed');
      const expander = rootEl.querySelector('.expander-box');
      if (expander) setExpanderGlyph(expander, true);
    }
  }

  // The +/− glyph is a CSS-drawn triangle; these classes are the sole source
  // of truth for which way it points.
  function setExpanderGlyph(box, expanded) {
    box.classList.toggle('minus', expanded);
    box.classList.toggle('plus', !expanded);
  }

  // ancestorLineMask: boolean[] of length `depth`.
  //   [i] = true  → ancestor at depth i has a following sibling, so its
  //                 pass-through column draws a full-height indent guide
  //   [i] = false → ancestor is a last child → that column is blank
  //
  // isLastSibling: true → corner guide (half height); false → tee (full).
  // The root always gets tc-root, which draws nothing.
  function createNodeEl(key, value, depth, parentData, ancestorLineMask, isLastSibling, path) {
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
      col.className = 'tc tc-pass' + (ancestorLineMask[i] ? ' has-line' : '');
      rowEl.appendChild(col);
    }

    const elbowCol = document.createElement('span');
    if (depth === 0) {
      elbowCol.className = 'tc tc-root';
    } else {
      elbowCol.className = 'tc tc-elbow ' + (isLastSibling ? 'tc-corner' : 'tc-tee');
    }

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
    rowEl.appendChild(iconEl);

    const labelEl = document.createElement('span');
    labelEl.className = 'tree-label';
    const labelText = isContainer ? key : key + ' : ' + formatLeafValue(value);
    labelEl.textContent = labelText;
    labelEl._rawText = labelText;   // find highlighting rebuilds from this
    rowEl.appendChild(labelEl);

    rowEl._nodeData = {
      key: key,
      value: value,
      type: type,
      isContainer: isContainer,
      parentData: parentData,
      depth: depth,
      path: path
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

      const isArray = type === 'array';
      const entries = isArray
        ? value.map((v, idx) => [String(idx), v])
        : Object.entries(value);

      // Children inherit this node's mask plus one entry for this node: a
      // guide continues downward only if this node has a following sibling.
      const childMask = ancestorLineMask.concat(!isLastSibling);

      for (let idx = 0; idx < entries.length; idx++) {
        const pair = entries[idx];
        const childPath = joinPath(path, pair[0], isArray);
        childrenEl.appendChild(createNodeEl(
          pair[0], pair[1], depth + 1, value, childMask,
          idx === entries.length - 1, childPath
        ));
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

  function toggleNode(nodeEl, box) {
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    if (!childrenEl) return;
    if (nodeAnimMap.has(nodeEl)) return;   // mid-animation: ignore
    startAnim(nodeEl, box, childrenEl.classList.contains('collapsed'));
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

  function expandAll() {
    allNodes().forEach(n => setExpanded(n, true));
    showStatus('Expanded all');
  }

  function collapseAll() {
    // Leave the root open, otherwise the window looks empty.
    allNodes().forEach((n, idx) => setExpanded(n, idx === 0));
    showStatus('Collapsed all');
  }

  // ----------------------------------------------------------------
  // Selection
  // ----------------------------------------------------------------
  function selectRow(rowEl) {
    if (selectedRow) selectedRow.classList.remove('selected');
    rowEl.classList.add('selected');
    selectedRow = rowEl;
    if (hoverPath === null) setPath(rowEl._nodeData.path);
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
  // Find
  // ----------------------------------------------------------------
  function allLabels() {
    return Array.prototype.slice.call(treeContainer.querySelectorAll('.tree-label'));
  }

  function clearFindHighlights() {
    allLabels().forEach(l => { l.textContent = l._rawText; });
    findMarks = [];
    findIndex = -1;
  }

  function runFind(query) {
    clearFindHighlights();
    if (!query) { updateFindCount(); return; }

    const needle = query.toLowerCase();
    allLabels().forEach(labelEl => {
      const text = labelEl._rawText;
      const hay = text.toLowerCase();
      if (hay.indexOf(needle) === -1) return;

      labelEl.textContent = '';
      let pos = 0;
      let idx;
      while ((idx = hay.indexOf(needle, pos)) !== -1) {
        if (idx > pos) labelEl.appendChild(document.createTextNode(text.slice(pos, idx)));
        const mark = document.createElement('mark');
        mark.className = 'find-match';
        mark.textContent = text.slice(idx, idx + needle.length);
        labelEl.appendChild(mark);
        findMarks.push(mark);
        pos = idx + needle.length;
      }
      if (pos < text.length) labelEl.appendChild(document.createTextNode(text.slice(pos)));
    });

    if (findMarks.length) gotoMatch(0);
    else updateFindCount();
  }

  function updateFindCount() {
    const total = findMarks.length;
    findCount.textContent = total ? (findIndex + 1) + ' of ' + total : '0 of 0';
    findPrev.disabled = total === 0;
    findNext.disabled = total === 0;
  }

  function gotoMatch(i) {
    if (!findMarks.length) { updateFindCount(); return; }
    if (findIndex >= 0 && findMarks[findIndex]) {
      findMarks[findIndex].classList.remove('current');
    }
    findIndex = (i % findMarks.length + findMarks.length) % findMarks.length;

    const mark = findMarks[findIndex];
    mark.classList.add('current');

    const row = mark.closest('.tree-row');
    if (row) {
      expandAncestors(row);
      selectRow(row);
      row.scrollIntoView({ block: 'center' });
    }
    updateFindCount();
  }

  function openFind() {
    findOpen = true;
    findbar.classList.add('open');
    btnFindOpen.classList.add('on');
    findInput.focus();
    findInput.select();
  }

  function closeFind() {
    findOpen = false;
    findbar.classList.remove('open');
    btnFindOpen.classList.remove('on');
    clearFindHighlights();
    updateFindCount();
  }

  findInput.addEventListener('input', () => runFind(findInput.value));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      gotoMatch(findIndex + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  findNext.addEventListener('click', () => gotoMatch(findIndex + 1));
  findPrev.addEventListener('click', () => gotoMatch(findIndex - 1));
  findDone.addEventListener('click', closeFind);
  btnFindOpen.addEventListener('click', () => (findOpen ? closeFind() : openFind()));

  // ----------------------------------------------------------------
  // Document loading
  // ----------------------------------------------------------------
  function loadParsed(data, opts) {
    const trulyEmpty = !!(opts && opts.trulyEmpty);
    parsedData = data;
    isEmpty = trulyEmpty;
    rawText = trulyEmpty ? '' : JSON.stringify(data, null, 2);

    if (findOpen) closeFind();

    appEl.classList.toggle('empty', trulyEmpty);
    if (trulyEmpty) {
      treeContainer.innerHTML = '';
      selectedRow = null;
    } else {
      buildTree(data);
      // Nothing is selected on load: the root's "selection" would paint a bar
      // across the top conveying nothing, and the status bar is more useful
      // showing the ⌘K / ⌘F hint until the reader picks a node.
    }
    setPath(selectedRow ? selectedRow._nodeData.path : null);
    restoreStatus();
  }

  function loadText(text) {
    const res = tryParse(text);
    if (!res.ok) {
      showError(res.message);
      return false;
    }
    loadParsed(res.data, { trulyEmpty: !!res.trulyEmpty });
    return true;
  }

  // ----------------------------------------------------------------
  // Source editor
  // ----------------------------------------------------------------
  function enterEdit() {
    editArea.value = rawText;
    appEl.classList.add('editing');
    btnEdit.classList.add('on');
    if (findOpen) closeFind();
    clearEditError();
    editArea.focus();
    // focus() leaves the caret at the end, which scrolls a long document out
    // of view; start at the top where the reader expects to be.
    editArea.setSelectionRange(0, 0);
    editArea.scrollTop = 0;
    editGutterInner.style.transform = 'translateY(0px)';
    restoreStatus();
  }

  // Leaving requires a document we can render; the status bar already says
  // what is wrong, so refuse rather than silently discarding the edit.
  function exitEdit() {
    const res = tryParse(editArea.value);
    if (!res.ok) {
      markEditError(res.line);
      showError(res.message);
      return false;
    }
    appEl.classList.remove('editing');
    btnEdit.classList.remove('on');
    clearEditError();
    loadParsed(res.data, { trulyEmpty: !!res.trulyEmpty });
    return true;
  }

  function clearEditError() { editGutterInner.innerHTML = ''; }

  function markEditError(line) {
    clearEditError();
    const marker = document.createElement('div');
    marker.className = 'edit-error-marker';
    marker.style.top = ((line - 1) * EDIT_LINE_HEIGHT + EDIT_LINE_HEIGHT / 2 - 4) + 'px';
    editGutterInner.appendChild(marker);
  }

  function validateEditBuffer() {
    const res = tryParse(editArea.value);
    if (res.ok) {
      clearEditError();
      restoreStatus();
    } else {
      markEditError(res.line);
      showError(res.message);
    }
  }

  editArea.addEventListener('input', validateEditBuffer);
  editArea.addEventListener('scroll', () => {
    editGutterInner.style.transform = 'translateY(' + (-editArea.scrollTop) + 'px)';
  });

  btnEdit.addEventListener('click', () => {
    if (appEl.classList.contains('editing')) exitEdit();
    else enterEdit();
  });

  // ----------------------------------------------------------------
  // Commands
  // ----------------------------------------------------------------
  function currentSource() {
    return appEl.classList.contains('editing') ? editArea.value : rawText;
  }

  function doFormat() {
    const res = tryParse(currentSource());
    if (!res.ok) { showError(res.message); return; }
    if (res.trulyEmpty) { showStatus('Nothing to format'); return; }
    const pretty = JSON.stringify(res.data, null, 2);
    if (appEl.classList.contains('editing')) {
      editArea.value = pretty;
      clearEditError();
    } else {
      rawText = pretty;
    }
    showStatus('Formatted');
  }

  function doMinify() {
    const res = tryParse(currentSource());
    if (!res.ok) { showError(res.message); return; }
    if (res.trulyEmpty) { showStatus('Nothing to minify'); return; }
    copyText(JSON.stringify(res.data));
    showStatus('Copied minified JSON');
  }

  function doCopyAll() {
    if (isEmpty && !appEl.classList.contains('editing')) {
      showStatus('Nothing to copy');
      return;
    }
    copyText(currentSource());
    showStatus('Copied');
  }

  function doCopySelection() {
    if (!selectedRow) { showStatus('Nothing selected'); return; }
    const nd = selectedRow._nodeData;
    copyText(nd.isContainer ? JSON.stringify(nd.value, null, 2) : formatLeafValue(nd.value));
    showStatus('Copied value');
  }

  function doCopyPath() {
    if (lastPath === null) { showStatus('No path'); return; }
    copyText(lastPath);
    showStatus('Copied path');
  }

  function doPaste() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      showError('Clipboard access denied — press ⌘V in the editor instead.');
      return;
    }
    navigator.clipboard.readText().then((text) => {
      if (appEl.classList.contains('editing')) {
        editArea.value = text;
        validateEditBuffer();
        return;
      }
      if (loadText(text)) showStatus('Pasted');
    }).catch(() => {
      showError('Clipboard access denied — press ⌘V in the editor instead.');
    });
  }

  function doClear() {
    if (appEl.classList.contains('editing')) {
      editArea.value = '';
      clearEditError();
      restoreStatus();
      return;
    }
    loadParsed(null, { trulyEmpty: true });
    showStatus('Cleared');
  }

  function doAbout() {
    showStatus('jsontree — runs entirely in your browser; nothing you paste is sent anywhere.');
  }

  btnFormat.addEventListener('click', doFormat);
  btnMinify.addEventListener('click', doMinify);
  btnCopy.addEventListener('click', doCopyAll);
  btnPaste.addEventListener('click', doPaste);

  // ----------------------------------------------------------------
  // Command palette
  // ----------------------------------------------------------------
  const actions = [
    { id: 'format',        label: 'Format',         hint: 'Re-indent with two spaces', run: doFormat },
    { id: 'minify',        label: 'Minify',         hint: 'Copy without whitespace',   run: doMinify },
    { id: 'copyAll',       label: 'Copy All',       hint: 'Copy the whole document',   run: doCopyAll },
    { id: 'copySelection', label: 'Copy Selection', hint: 'Copy the selected value',   run: doCopySelection },
    { id: 'copyPath',      label: 'Copy Path',      hint: 'Copy the selected path',    shortcut: '⌘⌥C', run: doCopyPath },
    { id: 'paste',         label: 'Paste',          hint: 'Replace with clipboard JSON', run: doPaste },
    { id: 'clear',         label: 'Clear',          hint: 'Empty the document',        run: doClear },
    { id: 'edit',          label: 'Edit Source',    hint: 'Toggle the source editor',  run: () => btnEdit.click() },
    { id: 'find',          label: 'Find',           shortcut: '⌘F',               run: () => setTimeout(openFind, 0) },
    { id: 'expandAll',     label: 'Expand All',     shortcut: '⌘⌥→',    run: expandAll },
    { id: 'collapseAll',   label: 'Collapse All',   shortcut: '⌘⌥←',    run: collapseAll },
    { id: 'about',         label: 'About jsontree', run: doAbout }
  ];

  let paletteActive = -1;
  let paletteFiltered = [];

  // Subsequence match, scored so that earlier and tighter runs win.
  function fuzzyScore(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (!q) return 0;
    let qi = 0, score = 0, lastHit = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score -= ti - lastHit;
        lastHit = ti;
        qi++;
      }
    }
    return qi === q.length ? score : null;
  }

  function renderPalette() {
    const query = paletteInput.value.trim();
    paletteFiltered = actions
      .map(a => ({ action: a, score: fuzzyScore(query, a.label) }))
      .filter(x => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(x => x.action);

    paletteList.innerHTML = '';
    if (!paletteFiltered.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching command';
      paletteList.appendChild(empty);
      paletteActive = -1;
      return;
    }

    paletteFiltered.forEach((a, i) => {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.setAttribute('role', 'option');

      const label = document.createElement('span');
      label.textContent = a.label;
      item.appendChild(label);

      if (a.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'p-shortcut';
        sc.textContent = a.shortcut;
        item.appendChild(sc);
      } else if (a.hint) {
        const hint = document.createElement('span');
        hint.className = 'p-hint';
        hint.textContent = a.hint;
        item.appendChild(hint);
      }

      item.addEventListener('mouseenter', () => setPaletteActive(i));
      item.addEventListener('click', () => runPaletteAction(i));
      paletteList.appendChild(item);
    });

    setPaletteActive(0);
  }

  function setPaletteActive(i) {
    paletteActive = i;
    const items = paletteList.querySelectorAll('.palette-item');
    items.forEach((el, idx) => el.classList.toggle('active', idx === i));
    if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
  }

  function runPaletteAction(i) {
    const action = paletteFiltered[i];
    if (!action) return;
    closePalette();
    action.run();
  }

  function openPalette() {
    paletteOverlay.classList.add('open');
    btnPaletteOpen.classList.add('on');
    paletteInput.value = '';
    renderPalette();
    paletteInput.focus();
  }

  function closePalette() {
    paletteOverlay.classList.remove('open');
    btnPaletteOpen.classList.remove('on');
  }

  paletteInput.addEventListener('input', renderPalette);
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPaletteActive(Math.min(paletteActive + 1, paletteFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPaletteActive(Math.max(paletteActive - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteAction(paletteActive);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });
  paletteOverlay.addEventListener('click', (e) => {
    if (e.target === paletteOverlay) closePalette();
  });
  btnPaletteOpen.addEventListener('click', openPalette);

  // ----------------------------------------------------------------
  // Keyboard
  // ----------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (paletteOverlay.classList.contains('open')) return;   // palette owns its keys

    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && !e.altKey && key === 'k') { e.preventDefault(); openPalette(); return; }
    if (mod && !e.altKey && key === 'f') { e.preventDefault(); openFind(); return; }
    if (mod && !e.altKey && key === 'g') {
      if (findOpen) { e.preventDefault(); gotoMatch(findIndex + (e.shiftKey ? -1 : 1)); }
      return;
    }
    if (mod && e.altKey && key === 'c') { e.preventDefault(); doCopyPath(); return; }
    if (mod && e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); collapseAll(); return; }
    if (mod && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); expandAll(); return; }

    if (e.key === 'Escape') {
      if (findOpen) { e.preventDefault(); closeFind(); }
      return;
    }

    // Arrow navigation belongs to the tree, not to a focused text field.
    const typing = document.activeElement === findInput ||
                   document.activeElement === editArea ||
                   document.activeElement === paletteInput;
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
      if (!loadText(text)) {
        // Unparseable: show the source so the problem is visible and fixable
        // rather than leaving a blank window.
        enterEdit();
        editArea.value = text;
        validateEditBuffer();
      }
    }
  };

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  loadParsed(null, { trulyEmpty: true });
  updateFindCount();
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
