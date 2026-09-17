# Privacy policy

**jsontree Chrome extension**

jsontree does not collect, store, or transmit any user data.

## What the extension does

The extension adds a content script that runs when your browser loads a
document. On every page it first checks whether that document is JSON — a
content type of `application/json`, `text/json` or `application/*+json`, or a
`text/plain` document whose path ends in `.json`. If it is not, the script
stops immediately and the page is left exactly as Chrome rendered it.

When the document *is* JSON, the extension replaces the browser's plain-text
rendering with a tree view of the same content. The JSON text it reads is the
text already present in the document you navigated to. Nothing is copied,
retained, or sent anywhere: the rendering happens in the page, in your browser,
and is discarded when you close the tab.

## What the extension does not do

- It makes no network requests of its own. All of its code and styling is
  bundled in the extension package; nothing is fetched at runtime.
- It has no background service worker and no remote code.
- It stores nothing — no cookies, no `localStorage`, no extension storage, no
  history of documents you have viewed.
- It contains no analytics, telemetry, advertising, or tracking of any kind.
- It does not sell or transfer user data to third parties, does not use data
  for any purpose unrelated to displaying the JSON document on screen, and does
  not use data to determine creditworthiness or for lending purposes.

## Permissions

The extension requests a content script match of `<all_urls>`. This is required
because a JSON document can be served from any origin, and there is no way to
know in advance which origins will serve one. The breadth of the match pattern
does not correspond to any data access: on a non-JSON page the script exits
without reading the page.

## Source code

The extension is open source and MIT licensed. The complete source, including
everything described above, is at <https://github.com/ceno/jsontree>.

## Contact

Please raise an issue at <https://github.com/ceno/jsontree/issues>.
