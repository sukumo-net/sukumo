// Sukumo vat — auto-rename + organise uploads into dated subfolders.
//
// Runs on a 5-minute timer in Google Apps Script. For each new file in
// the "incoming" folder:
//   1. Rename the file: "original.jpg" -> "2026-05-06_14-30_original.jpg"
//   2. Find or create a dated subfolder ("2026-05-06") under the parent
//      "media" folder.
//   3. Move the file into that dated subfolder.
//   4. Files that already start with YYYY-MM-DD_ are left alone (so the
//      script is idempotent and safe to re-run).
//
// Setup:
//   1. Open https://script.google.com → New project.
//   2. Paste this code in.
//   3. Replace the two folder IDs below.
//   4. Save (Cmd-S, name the project "sukumo media organiser").
//   5. Run renameNewUploads once manually to grant Drive permissions.
//   6. Triggers (left sidebar, clock icon) → Add Trigger.
//      Function: renameNewUploads
//      Event source: Time-driven
//      Type: Minutes timer
//      Every: 5 minutes
//      Save.
//
// Now any file dropped into the incoming folder gets renamed and moved
// within ~5 min. The incoming folder stays empty (or has only just-
// uploaded files waiting for the next trigger).

// === CONFIG ============================================================

// The folder caretakers upload INTO (shared "anyone with link can edit").
// Find the ID in the URL: https://drive.google.com/drive/folders/<THIS-PART>
const INCOMING_FOLDER_ID = '1rVcjffMahZgunWBBHu5vXFo3gJUlTd_s';

// The folder where dated subfolders are created (organised, owner-only or
// "anyone with link can view"). Typically the project's main folder where
// dated daily subfolders already exist (pre-populated by the Pi setup).
const ARCHIVE_PARENT_ID = '1y3jm0QCAe57wcfm8fttFUXLUr00CCP5D';

// === SCRIPT ============================================================

function renameNewUploads() {
  const incoming = DriveApp.getFolderById(INCOMING_FOLDER_ID);
  const archive  = DriveApp.getFolderById(ARCHIVE_PARENT_ID);

  const files = incoming.getFiles();
  let moved = 0;

  while (files.hasNext()) {
    const file = files.next();
    const original = file.getName();

    // Skip files we've already processed (start with YYYY-MM-DD_).
    if (/^\d{4}-\d{2}-\d{2}_/.test(original)) {
      continue;
    }

    const created = file.getDateCreated();
    const tz = Session.getScriptTimeZone();
    const dateStamp = Utilities.formatDate(created, tz, 'yyyy-MM-dd');
    const timeStamp = Utilities.formatDate(created, tz, 'HH-mm');

    const newName = dateStamp + '_' + timeStamp + '_' + original;
    file.setName(newName);

    // Find or create the dated subfolder under the archive parent.
    const dateFolder = getOrCreateChildFolder_(archive, dateStamp);

    // Move the file: add to date folder, remove from incoming.
    dateFolder.addFile(file);
    incoming.removeFile(file);

    Logger.log('Moved %s -> %s/%s', original, dateStamp, newName);
    moved++;
  }

  if (moved > 0) {
    Logger.log('Processed %d new file(s).', moved);
  }
}

function getOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) {
    return it.next();
  }
  return parent.createFolder(name);
}
