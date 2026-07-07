/* jsontree — app.js */
(function () {
  'use strict';

  // ----------------------------------------------------------------
  // DOM refs
  // ----------------------------------------------------------------
  const tabText    = document.getElementById('tab-text');
  const tabViewer  = document.getElementById('tab-viewer');
  const panelText  = document.getElementById('panel-text');
  const panelViewer = document.getElementById('panel-viewer');
  const jsonInput  = document.getElementById('json-input');
  const statusText = document.getElementById('status-text');

  const btnPaste   = document.getElementById('btn-paste');
  const btnCopy    = document.getElementById('btn-copy');
  const btnFormat  = document.getElementById('btn-format');
  const btnMinify  = document.getElementById('btn-minify');
  const btnClear   = document.getElementById('btn-clear');
  const btnAbout   = document.getElementById('btn-about');

  const treeContainer = document.getElementById('tree-container');
  const gridBody      = document.getElementById('grid-body');
  const gridColName   = document.getElementById('grid-col-name');
  const gridColValue  = document.getElementById('grid-col-value');
  const sortArrowName  = document.getElementById('sort-arrow-name');
  const sortArrowValue = document.getElementById('sort-arrow-value');

  const splitter     = document.getElementById('splitter');
  const gridPanel    = document.getElementById('grid-panel');

  const searchInput  = document.getElementById('search-input');
  const btnSearchGo  = document.getElementById('btn-search-go');
  const btnSearchNext = document.getElementById('btn-search-next');
  const btnSearchPrev = document.getElementById('btn-search-prev');

  const modalOverlay  = document.getElementById('modal-overlay');
  const modalTitle    = document.getElementById('modal-title');
  const modalMessage  = document.getElementById('modal-message');
  const modalErrorIcon = document.getElementById('modal-error-icon');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalOkBtn    = document.getElementById('modal-ok-btn');

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let activeTab = 'text';
  let parsedData = null;
  let selectedNode = null;       // { data, parent, key, depth, el, childrenEl }
  let searchMatches = [];
  let searchIndex = -1;
  let sortCol = 'name';
  let sortAsc = true;
  let statusTimer = null;

  // ----------------------------------------------------------------
  // Tab switching
  // ----------------------------------------------------------------
  function activateTab(name) {
    if (name === 'viewer') {
      const raw = jsonInput.value.trim();
      if (raw === '') {
        // Empty → show empty tree, no error
        parsedData = null;
        activeTab = 'viewer';
        applyTabUI();
        buildTree(null);
        renderGrid(null);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        showDialog('JSON error', 'Invalid JSON variable', true);
        return; // stay on text tab
      }
      parsedData = parsed;
      activeTab = 'viewer';
      applyTabUI();
      searchMatches = [];
      searchIndex = -1;
      buildTree(parsedData);
      // Select root implicitly
      const firstRow = treeContainer.querySelector('.tree-row');
      if (firstRow) {
        selectRow(firstRow);
      }
    } else {
      activeTab = 'text';
      applyTabUI();
    }
  }

  function applyTabUI() {
    if (activeTab === 'text') {
      panelText.classList.add('active');
      panelViewer.classList.remove('active');
      tabText.classList.add('active');
      tabViewer.classList.remove('active');
    } else {
      panelViewer.classList.add('active');
      panelText.classList.remove('active');
      tabViewer.classList.add('active');
      tabText.classList.remove('active');
    }
  }

  tabText.addEventListener('click', () => activateTab('text'));
  tabViewer.addEventListener('click', () => activateTab('viewer'));

  // ----------------------------------------------------------------
  // Modal dialog
  // ----------------------------------------------------------------
  function showDialog(title, message, isError = false) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    if (isError) {
      modalErrorIcon.classList.remove('hidden');
    } else {
      modalErrorIcon.classList.add('hidden');
    }
    modalOverlay.classList.remove('hidden');
  }

  function closeDialog() {
    modalOverlay.classList.add('hidden');
  }

  modalCloseBtn.addEventListener('click', closeDialog);
  modalOkBtn.addEventListener('click', closeDialog);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
      closeDialog();
    }
  });

  // ----------------------------------------------------------------
  // Status bar
  // ----------------------------------------------------------------
  function showStatus(msg, duration = 2000) {
    statusText.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusText.textContent = ''; }, duration);
  }

  // ----------------------------------------------------------------
  // Text toolbar buttons
  // ----------------------------------------------------------------
  btnPaste.addEventListener('click', async () => {
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        jsonInput.value = text;
      } catch (e) {
        showDialog('Error', 'Clipboard access denied. Press Ctrl+V / Cmd+V to paste.', true);
      }
    } else {
      showDialog('Error', 'Clipboard access denied. Press Ctrl+V / Cmd+V to paste.', true);
    }
  });

  btnCopy.addEventListener('click', async () => {
    const text = jsonInput.value;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        jsonInput.select();
        document.execCommand('copy');
      }
      showStatus('Copied');
    } catch (e) {
      showStatus('Copy failed');
    }
  });

  btnFormat.addEventListener('click', () => {
    const raw = jsonInput.value;
    try {
      const parsed = JSON.parse(raw);
      jsonInput.value = JSON.stringify(parsed, null, 2);
    } catch (e) {
      showDialog('JSON error', 'Invalid JSON variable', true);
    }
  });

  btnMinify.addEventListener('click', () => {
    const raw = jsonInput.value;
    try {
      const parsed = JSON.parse(raw);
      jsonInput.value = JSON.stringify(parsed);
    } catch (e) {
      showDialog('JSON error', 'Invalid JSON variable', true);
    }
  });

  btnClear.addEventListener('click', () => {
    jsonInput.value = '';
  });

  btnAbout.addEventListener('click', () => {
    showDialog(
      'About',
      'jsontree\nA JSON viewer and formatter.\nRuns entirely in your browser — nothing you paste is sent anywhere.',
      false
    );
  });

  // ----------------------------------------------------------------
  // Tree building
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

  function buildTree(data) {
    treeContainer.innerHTML = '';
    searchMatches = [];
    searchIndex = -1;
    selectedNode = null;

    if (data === null && arguments[0] === null && jsonInput.value.trim() === '') {
      return; // empty
    }
    if (arguments[0] === null) return;

    // Root is the only child at depth 0; treat it as "last sibling" so column 0
    // propagates no vertical line to its children (root has no following sibling).
    const rootEl = createNodeEl('JSON', data, 0, null, [], true);
    treeContainer.appendChild(rootEl);
    // Expand root instantly (not user-initiated, so no animation)
    const rootChildren = rootEl.querySelector('.tree-children');
    if (rootChildren) {
      rootChildren.classList.remove('collapsed');
      const expander = rootEl.querySelector('.expander-box');
      if (expander) expander.textContent = '−';
    }
  }

  // ancestorLineMask: boolean[] of length `depth`.
  //   ancestorLineMask[i] = true  → ancestor at depth i has a following sibling
  //                                  → show full-height vertical line in pass-through column i
  //   ancestorLineMask[i] = false → ancestor is last child → pass-through column i is blank
  //
  // isLastSibling: true → this node is the last child of its parent → corner elbow
  //                false → it has a following sibling → tee elbow
  //                (root always gets tc-root with no lines regardless)
  function createNodeEl(key, value, depth, parentData, ancestorLineMask, isLastSibling) {
    const type = getType(value);
    const isContainer = type === 'object' || type === 'array';

    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';

    // ---- Row ----
    const rowEl = document.createElement('div');
    rowEl.className = 'tree-row';
    rowEl.setAttribute('data-depth', depth);

    // Pass-through columns (one per ancestor depth 0..depth-1)
    for (let i = 0; i < depth; i++) {
      const col = document.createElement('span');
      col.className = 'tc tc-pass' + (ancestorLineMask[i] ? ' has-line' : '');
      rowEl.appendChild(col);
    }

    // Elbow column (the node's own indentation column)
    const elbowCol = document.createElement('span');
    if (depth === 0) {
      // Root: no connector lines — just hosts the expander box
      elbowCol.className = 'tc tc-root';
    } else {
      elbowCol.className = 'tc tc-elbow ' + (isLastSibling ? 'tc-corner' : 'tc-tee');
    }

    // Expander box lives inside the elbow column, absolutely centred
    if (isContainer) {
      const box = document.createElement('span');
      box.className = 'expander-box';
      box.textContent = '+';
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNode(nodeEl, box);
      });
      elbowCol.appendChild(box);
    }
    // Leaves: no child element — the horizontal stub is fully visible

    rowEl.appendChild(elbowCol);

    // Icon
    const iconEl = document.createElement('span');
    iconEl.className = 'tree-icon icon-' + type;
    rowEl.appendChild(iconEl);

    // Label
    const labelEl = document.createElement('span');
    labelEl.className = 'tree-label';
    if (isContainer) {
      labelEl.textContent = key;
    } else {
      labelEl.textContent = key + ' : ' + formatLeafValue(value);
    }
    rowEl.appendChild(labelEl);

    // Metadata for selection / search
    rowEl._nodeData = {
      key: key,
      value: value,
      type: type,
      isContainer: isContainer,
      parentData: parentData,
      depth: depth
    };

    rowEl.addEventListener('click', () => selectRow(rowEl));

    if (isContainer) {
      rowEl.addEventListener('dblclick', () => {
        const box = rowEl.querySelector('.expander-box');
        if (box) toggleNode(nodeEl, box);
      });
    }

    nodeEl.appendChild(rowEl);

    // ---- Children ----
    if (isContainer) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children collapsed';

      const entries = type === 'array'
        ? value.map((v, i) => [String(i), v])
        : Object.entries(value);

      // The ancestorLineMask for children adds one entry for THIS node:
      // has line iff this node is NOT the last sibling (a vertical continues downward).
      const childAncestorLineMask = ancestorLineMask.concat(!isLastSibling);

      for (let idx = 0; idx < entries.length; idx++) {
        const [k, v] = entries[idx];
        const childIsLast = (idx === entries.length - 1);
        const childEl = createNodeEl(k, v, depth + 1, value, childAncestorLineMask, childIsLast);
        childrenEl.appendChild(childEl);
      }

      nodeEl.appendChild(childrenEl);
    }

    return nodeEl;
  }

  // ----------------------------------------------------------------
  // Slide animation for expand/collapse
  // ----------------------------------------------------------------
  const nodeAnimMap = new WeakMap(); // nodeEl → { raf, expanding, childrenEl, inner, box }
  const ANIM_DURATION = 250;

  function easeOut(t) {
    return 1 - (1 - t) * (1 - t);
  }

  // Cancel ongoing animation and jump to its end state immediately.
  function finishAnimInstantly(nodeEl) {
    const anim = nodeAnimMap.get(nodeEl);
    if (!anim) return;
    cancelAnimationFrame(anim.raf);
    const { expanding, childrenEl, inner, box } = anim;
    // Move children back out of the temporary wrapper
    while (inner.firstChild) {
      childrenEl.appendChild(inner.firstChild);
    }
    inner.remove();
    childrenEl.style.overflow = '';
    childrenEl.style.height = '';
    if (expanding) {
      childrenEl.classList.remove('collapsed');
      box.textContent = '−';
    } else {
      childrenEl.classList.add('collapsed');
      box.textContent = '+';
    }
    nodeAnimMap.delete(nodeEl);
  }

  // Start an animated expand (expanding=true) or collapse (expanding=false).
  function startAnim(nodeEl, box, expanding) {
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    if (!childrenEl) return;

    if (expanding) {
      // Remove display:none before measuring natural height.
      // The height:0 below prevents a visible flash since JS is sync before paint.
      childrenEl.classList.remove('collapsed');
    }

    const H = childrenEl.scrollHeight;
    if (H === 0) {
      // Nothing to animate (empty container)
      if (!expanding) childrenEl.classList.add('collapsed');
      box.textContent = expanding ? '−' : '+';
      return;
    }

    // Set up overflow clip on the children container
    childrenEl.style.overflow = 'hidden';
    childrenEl.style.height = (expanding ? 0 : H) + 'px';

    // Wrap all child nodes in a temporary div so we can apply the Y offset
    const inner = document.createElement('div');
    inner.style.marginTop = (expanding ? -H : 0) + 'px';
    while (childrenEl.firstChild) {
      inner.appendChild(childrenEl.firstChild);
    }
    childrenEl.appendChild(inner);

    // Update expander symbol immediately
    box.textContent = expanding ? '−' : '+';

    const startTime = performance.now();
    let rafId;

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / ANIM_DURATION);
      const f = easeOut(t);

      // h = clip height; offset = (h - H) so bottom of content tracks bottom of clip
      const h = Math.round(H * (expanding ? f : 1 - f));
      const offset = h - H;

      childrenEl.style.height = h + 'px';
      inner.style.marginTop = offset + 'px';

      if (t < 1) {
        rafId = requestAnimationFrame(frame);
        nodeAnimMap.get(nodeEl).raf = rafId;
      } else {
        // Animation complete — restore static layout
        while (inner.firstChild) {
          childrenEl.appendChild(inner.firstChild);
        }
        inner.remove();
        childrenEl.style.overflow = '';
        childrenEl.style.height = '';
        if (!expanding) {
          childrenEl.classList.add('collapsed');
        }
        nodeAnimMap.delete(nodeEl);
      }
    }

    rafId = requestAnimationFrame(frame);
    nodeAnimMap.set(nodeEl, { raf: rafId, expanding, childrenEl, inner, box });
  }

  function toggleNode(nodeEl, box) {
    const childrenEl = nodeEl.querySelector(':scope > .tree-children');
    if (!childrenEl) return;

    if (nodeAnimMap.has(nodeEl)) {
      // Mid-animation: ignore further toggles until it finishes
      return;
    }

    const isCollapsed = childrenEl.classList.contains('collapsed');
    startAnim(nodeEl, box, isCollapsed);
  }

  function expandAncestors(rowEl) {
    // Walk up through DOM to expand all collapsed ancestors — always instant (no animation)
    // so that search jumps are immediate.
    let el = rowEl.parentElement;
    while (el && el !== treeContainer) {
      if (el.classList.contains('tree-children')) {
        const parentNode = el.parentElement;
        // If this ancestor is mid-animation, finish it instantly first
        if (nodeAnimMap.has(parentNode)) {
          finishAnimInstantly(parentNode);
        }
        // Now expand if still collapsed
        if (el.classList.contains('collapsed')) {
          el.classList.remove('collapsed');
          const box = parentNode.querySelector(':scope > .tree-row .expander-box');
          if (box) box.textContent = '−';
        }
      }
      el = el.parentElement;
    }
  }

  function selectRow(rowEl) {
    // Deselect previous
    if (selectedNode) {
      selectedNode.classList.remove('selected');
    }
    rowEl.classList.add('selected');
    selectedNode = rowEl;
    const nd = rowEl._nodeData;
    if (nd.isContainer) {
      renderGrid(nd.value);
    } else {
      renderGrid(nd.parentData);
    }
  }

  // ----------------------------------------------------------------
  // Property grid
  // ----------------------------------------------------------------
  function renderGrid(containerData) {
    gridBody.innerHTML = '';
    if (containerData === null || containerData === undefined) return;

    const type = getType(containerData);
    let entries;
    if (type === 'array') {
      entries = containerData.map((v, i) => ({ name: String(i), value: v }));
    } else if (type === 'object') {
      entries = Object.entries(containerData).map(([k, v]) => ({ name: k, value: v }));
    } else {
      return;
    }

    // Sort
    entries.sort((a, b) => {
      let av, bv;
      if (sortCol === 'name') {
        av = a.name; bv = b.name;
      } else {
        av = String(a.value); bv = String(b.value);
      }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });

    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'grid-row';

      const cellName = document.createElement('div');
      cellName.className = 'grid-cell grid-cell-name';
      cellName.textContent = entry.name;

      const cellVal = document.createElement('div');
      cellVal.className = 'grid-cell grid-cell-value';
      const vtype = getType(entry.value);
      if (vtype === 'object' || vtype === 'array') {
        cellVal.textContent = '...';
      } else {
        cellVal.textContent = formatLeafValue(entry.value);
      }

      row.appendChild(cellName);
      row.appendChild(cellVal);
      frag.appendChild(row);
    }
    gridBody.appendChild(frag);
  }

  // Grid header sort
  function setGridSort(col) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
    // Update arrows
    if (sortCol === 'name') {
      sortArrowName.textContent = sortAsc ? '▲' : '▼';
      sortArrowName.classList.remove('hidden');
      sortArrowValue.classList.add('hidden');
    } else {
      sortArrowValue.textContent = sortAsc ? '▲' : '▼';
      sortArrowValue.classList.remove('hidden');
      sortArrowName.classList.add('hidden');
    }
    // Re-render with current node
    if (selectedNode) {
      const nd = selectedNode._nodeData;
      if (nd.isContainer) {
        renderGrid(nd.value);
      } else {
        renderGrid(nd.parentData);
      }
    }
  }

  gridColName.addEventListener('click', () => setGridSort('name'));
  gridColValue.addEventListener('click', () => setGridSort('value'));

  // ----------------------------------------------------------------
  // Splitter drag
  // ----------------------------------------------------------------
  let splitterDragging = false;
  let splitterStartX = 0;
  let splitterStartWidth = 0;

  splitter.addEventListener('mousedown', (e) => {
    splitterDragging = true;
    splitterStartX = e.clientX;
    splitterStartWidth = gridPanel.offsetWidth;
    splitter.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!splitterDragging) return;
    const delta = splitterStartX - e.clientX; // drag left = increase grid
    const viewerW = document.getElementById('viewer-inner').offsetWidth;
    const maxW = viewerW * 0.6;
    const newW = Math.max(120, Math.min(maxW, splitterStartWidth + delta));
    gridPanel.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (splitterDragging) {
      splitterDragging = false;
      splitter.classList.remove('dragging');
    }
  });

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------
  function getNodeLabel(rowEl) {
    return rowEl._nodeData
      ? (rowEl._nodeData.isContainer
        ? rowEl._nodeData.key
        : rowEl._nodeData.key + ' : ' + formatLeafValue(rowEl._nodeData.value))
      : '';
  }

  function doSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) return;

    // Collect all .tree-row in document order
    const allRows = Array.from(treeContainer.querySelectorAll('.tree-row'));
    searchMatches = allRows.filter(r => {
      const label = getNodeLabel(r).toLowerCase();
      return label.includes(query);
    });
    searchIndex = -1;

    if (searchMatches.length > 0) {
      searchIndex = 0;
      jumpToMatch(searchIndex);
    }
  }

  function jumpToMatch(idx) {
    const rowEl = searchMatches[idx];
    if (!rowEl) return;
    expandAncestors(rowEl);
    selectRow(rowEl);
    rowEl.scrollIntoView({ block: 'nearest' });
  }

  btnSearchGo.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  btnSearchNext.addEventListener('click', () => {
    if (searchMatches.length === 0) return;
    searchIndex = (searchIndex + 1) % searchMatches.length;
    jumpToMatch(searchIndex);
  });

  btnSearchPrev.addEventListener('click', () => {
    if (searchMatches.length === 0) return;
    searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
    jumpToMatch(searchIndex);
  });

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  // Text tab is active on page load (already set in HTML via .active on panel-text)
  tabText.classList.add('active');

})();
