/* jsontree — keeps the content script registration in step with what the user
 * has granted.
 *
 * The viewer has to look at every document to know whether it is JSON: the
 * decision is made from document.contentType, which you can only read by
 * already running on the page. Declaring that statically in the manifest means
 * shipping <all_urls>, which costs an in-depth Chrome Web Store review. So the
 * host access is optional instead: nothing runs until the user grants it from
 * grant.html, and then we register exactly the scripts the manifest used to
 * declare.
 */
'use strict';

const SCRIPT_ID = 'jsontree-viewer';

// Must stay in step with the file:/// entry in manifest.json, which covers
// local files: Chrome will not grant file:///* through permissions.request(),
// so that one scheme has to be declared statically and is gated by the
// browser's own "Allow access to file URLs" toggle instead.
const JS = ['vendor/markup.js', 'bootstrap.js', 'vendor/app.js'];

// permissions.getAll() reports the manifest's file:/// content script as a
// granted origin, which would otherwise read as "access already granted" and
// register a second, redundant script for local files. Only the web origins
// here are ours to register.
function webOrigins(origins) {
  return (origins || []).filter((o) => /^(\*|https?):\/\//.test(o));
}

// Registration must be a subset of what has actually been granted, so the
// granted origins are the match patterns.
async function sync() {
  const all = await chrome.permissions.getAll();
  const origins = webOrigins(all.origins);
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [SCRIPT_ID]
  });

  if (!origins.length) {
    if (registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
    return;
  }

  const script = {
    id: SCRIPT_ID,
    js: JS,
    matches: origins,
    runAt: 'document_start',
    allFrames: false,
    // Survives browser restarts, so the grant is genuinely once per machine.
    persistAcrossSessions: true
  };

  try {
    if (registered.length) {
      await chrome.scripting.updateContentScripts([script]);
    } else {
      await chrome.scripting.registerContentScripts([script]);
    }
  } catch (e) {
    console.error('jsontree: could not register content scripts', e);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await sync();
  // Nothing works until access is granted, so say so rather than looking broken.
  if (details.reason === 'install') {
    const { origins } = await chrome.permissions.getAll();
    if (!webOrigins(origins).length) {
      chrome.tabs.create({ url: chrome.runtime.getURL('grant.html') });
    }
  }
});

chrome.runtime.onStartup.addListener(sync);
chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
