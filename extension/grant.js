/* jsontree — the one-time grant.
 *
 * The extension ships with no host access at all. This page asks for it, which
 * is what lets background.js register the viewer's content scripts.
 */
'use strict';

// Web origins are the only thing that can be asked for at runtime: Chrome
// silently refuses a permissions.request() for file:///*, verified against a
// real browser. Local files are handled by the static content script in the
// manifest instead, which needs "Allow access to file URLs" rather than a grant.
const WEB = ['*://*/*'];

const statusEl = document.getElementById('status');
const noteEl = document.getElementById('note');
const grantBtn = document.getElementById('grant');
const revokeBtn = document.getElementById('revoke');

grantBtn.addEventListener('click', async () => {
  grantBtn.disabled = true;
  try {
    await chrome.permissions.request({ origins: WEB });
  } finally {
    grantBtn.disabled = false;
    render();
  }
});

revokeBtn.addEventListener('click', async () => {
  await chrome.permissions.remove({ origins: WEB });
  render();
});

async function render() {
  const { origins = [] } = await chrome.permissions.getAll();
  const hasWeb = origins.some((o) => o.startsWith('*://') || o.startsWith('http'));

  statusEl.textContent = hasWeb ? 'on' : 'not granted';
  statusEl.className = hasWeb ? 'on' : 'off';
  grantBtn.hidden = hasWeb;
  revokeBtn.hidden = !hasWeb;

  if (!hasWeb) {
    noteEl.textContent =
      'jsontree only reads a page to check whether it is a JSON document, and ' +
      'leaves every other page untouched. Nothing is collected or sent anywhere.';
    return;
  }

  const fileAllowed = await isFileAccessAllowed();
  if (fileAllowed) {
    noteEl.textContent =
      'Local .json files open in the viewer too. Reload any JSON tab that is ' +
      'already open.';
  } else {
    noteEl.textContent =
      'For local .json files, also tick "Allow access to file URLs" on this ' +
      'extension\'s card in chrome://extensions. Reload any JSON tab that is ' +
      'already open.';
  }
}

function isFileAccessAllowed() {
  return new Promise((resolve) => {
    if (!chrome.extension || !chrome.extension.isAllowedFileSchemeAccess) {
      return resolve(false);
    }
    chrome.extension.isAllowedFileSchemeAccess(resolve);
  });
}

render();
