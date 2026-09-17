/* jsontree — Chrome extension bootstrap.
 *
 * Runs at document_start on every page. On a page that is really a JSON
 * document (Chrome renders those as a lone <pre> of raw text) it throws away
 * the document and rebuilds it as the jsontree app. Everywhere else it costs
 * one content-type check and returns.
 */
(function () {
  'use strict';

  // Above this the tree would be slower to build than it is useful; leave the
  // raw text alone rather than hanging the tab.
  const MAX_BYTES = 10 * 1024 * 1024;

  // vendor/app.js is the next content script in the list. Tell it to park
  // itself: there is no DOM to bind to until takeOver() builds one.
  window.__JSONTREE_DEFER__ = true;

  if (!looksLikeJsonDocument()) return;

  // Hide the raw text while we wait for the parser. Setting .style directly is
  // not subject to the page's CSP the way an injected <style> element is.
  const html = document.documentElement;
  html.style.visibility = 'hidden';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', takeOver, { once: true });
  } else {
    takeOver();
  }

  function looksLikeJsonDocument() {
    const ct = (document.contentType || '').toLowerCase();
    if (ct === 'application/json' || ct === 'text/json') return true;
    if (/^application\/[\w.+-]+\+json$/.test(ct)) return true;
    // Servers that mislabel JSON as plain text, plus local .json files.
    return ct === 'text/plain' && /\.json$/i.test(location.pathname);
  }

  // The raw document is <body><pre>…</pre></body>, give or take an empty
  // container Chrome adds of its own. Requiring the <pre> to hold all of the
  // body's text rules out real pages that merely claim a JSON content type.
  function rawText() {
    const body = document.body;
    const pre = body && body.querySelector('pre');
    if (!pre) return null;
    const text = pre.textContent;
    if (body.textContent.trim() !== text.trim()) return null;
    return text;
  }

  function bail() {
    html.style.visibility = '';
  }

  function takeOver() {
    const text = rawText();
    if (text === null || text.length > MAX_BYTES) return bail();
    try {
      JSON.parse(text);
    } catch (e) {
      return bail(); // malformed JSON is easier to debug as raw text
    }

    if (!document.head) {
      document.documentElement.insertBefore(
        document.createElement('head'), document.documentElement.firstChild);
    }
    document.head.appendChild(link('stylesheet', 'vendor/style.css'));
    document.head.appendChild(link('icon', 'vendor/favicon.svg', 'image/svg+xml'));

    document.body.innerHTML = window.__JSONTREE_MARKUP__;
    window.__jsontreeMain();
    window.jsontree.load(text);
    html.style.visibility = '';
  }

  function link(rel, path, type) {
    const el = document.createElement('link');
    el.rel = rel;
    el.href = chrome.runtime.getURL(path);
    if (type) el.type = type;
    return el;
  }
})();
