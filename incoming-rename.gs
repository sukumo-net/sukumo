// Sukumo vat — auto-rename + organise uploads into dated subfolders.
//
// Runs on a 5-minute timer in Google Apps Script. For each new file in
// the "incoming" folder, decide which date the file "belongs to" using
// this priority:
//   1. If the filename already starts with YYYY-MM-DD_, use that.
//      (Manual override for backdated uploads.)
//   2. Otherwise, pull the file's own capture metadata:
//        - images: EXIF DateTimeOriginal (imageMediaMetadata.time)
//        - videos: container creation time (videoMediaMetadata.createTime)
//   3. If neither is available (screenshots, audio, edited files), fall
//      back to the Drive upload time.
//
// Once a date is decided:
//   - Rename: "original.jpg" -> "2026-05-16_14-30_original.jpg"
//     (skipped if the file already has the YYYY-MM-DD_HH-MM_ prefix)
//   - Find or create a dated subfolder ("2026-05-16") under the archive
//     parent.
//   - Move the file into that dated subfolder.
//
// Setup:
//   1. Open https://script.google.com → New project (or your existing one).
//   2. Paste this code in.
//   3. Replace the two folder IDs below if they differ.
//   4. **Enable the advanced Drive service:**
//      Left sidebar → Services (the + icon) → "Drive API" → Add.
//      Leave the version at v3.
//   5. Save (Cmd-S, name it "sukumo media organiser").
//   6. Run renameNewUploads once manually to grant Drive permissions.
//      (The Advanced Drive service may prompt for a new scope on first
//      run — accept it.)
//   7. Triggers (left sidebar, clock icon) → Add Trigger.
//      Function: renameNewUploads
//      Event source: Time-driven
//      Type: Minutes timer
//      Every: 5 minutes
//      Save.
//
// Any file dropped into the incoming folder gets renamed + routed within
// ~5 min. The incoming folder stays empty (or has only just-uploaded
// files waiting for the next trigger).

// === CONFIG ============================================================

// The folder caretakers upload INTO (shared "anyone with link can edit").
// Find the ID in the URL: https://drive.google.com/drive/folders/<THIS-PART>
const INCOMING_FOLDER_ID = '1rVcjffMahZgunWBBHu5vXFo3gJUlTd_s';

// The folder where dated subfolders are created (organised, owner-only or
// "anyone with link can view"). Typically the project's main folder where
// dated daily subfolders already exist (pre-populated by the Pi setup).
const ARCHIVE_PARENT_ID = '1y3jm0QCAe57wcfm8fttFUXLUr00CCP5D';

// === SCRIPT ============================================================

// Defer images/videos for this many minutes after upload if their
// media metadata hasn't been extracted yet. Drive's EXIF / container
// extraction is asynchronous and usually finishes within a minute or two,
// but can be slower for larger files. The script retries each cycle.
const METADATA_GRACE_MINUTES = 30;

function renameNewUploads() {
  const incoming = DriveApp.getFolderById(INCOMING_FOLDER_ID);
  const archive  = DriveApp.getFolderById(ARCHIVE_PARENT_ID);

  const files = incoming.getFiles();
  let moved = 0;
  let deferred = 0;

  while (files.hasNext()) {
    const file = files.next();
    const original = file.getName();

    // (1) Manual override via filename prefix.
    const prefixed = original.match(/^(\d{4}-\d{2}-\d{2})_/);
    let dateStamp;
    let newName;
    if (prefixed) {
      dateStamp = prefixed[1];
      newName = original;  // already correctly named, no rename needed
    } else {
      // (2) Fetch metadata once; reuse for both deferral check and date.
      // Note: Drive API v3 does not expose a video creation date, only
      // dimensions / duration. Videos will fall back to upload time.
      const meta = Drive.Files.get(file.getId(), {
        fields: 'createdTime,mimeType,imageMediaMetadata(time)',
      });

      // (2a) Defer images whose EXIF isn't ready yet — Drive extracts
      // EXIF asynchronously, so a file uploaded a moment ago may not
      // have its imageMediaMetadata populated yet.
      const mt = meta.mimeType || '';
      const isImage = mt.indexOf('image/') === 0;
      const hasImageMeta = meta.imageMediaMetadata && meta.imageMediaMetadata.time;
      const uploadAgeMin = (Date.now() - new Date(meta.createdTime).getTime()) / 60000;

      if (isImage && !hasImageMeta && uploadAgeMin < METADATA_GRACE_MINUTES) {
        Logger.log('Deferring %s (no EXIF yet, uploaded %s min ago)',
                   original, uploadAgeMin.toFixed(1));
        deferred++;
        continue;  // try again next cycle
      }

      // (2b + 3) Use EXIF capture date if available, else upload time.
      const captureDate = pickCaptureDate_(meta);
      const tz = Session.getScriptTimeZone();
      dateStamp = Utilities.formatDate(captureDate, tz, 'yyyy-MM-dd');
      const timeStamp = Utilities.formatDate(captureDate, tz, 'HH-mm');
      newName = dateStamp + '_' + timeStamp + '_' + original;
      file.setName(newName);
    }

    // Find or create the dated subfolder under the archive parent.
    const dateFolder = getOrCreateChildFolder_(archive, dateStamp);

    // Move the file: add to date folder, remove from incoming.
    dateFolder.addFile(file);
    incoming.removeFile(file);

    Logger.log('Moved %s -> %s/%s', original, dateStamp, newName);
    moved++;
  }

  if (moved > 0 || deferred > 0) {
    Logger.log('Processed %d file(s), deferred %d.', moved, deferred);
  }
}

// Picks the most representative "creation" date from a Drive metadata
// object:
//   - EXIF DateTimeOriginal for images (imageMediaMetadata.time)
//   - Drive upload time (createdTime) for videos and everything else
//     (Drive API v3 does not expose a video capture date).
//
// The metadata is fetched once by renameNewUploads() and passed in here
// so we don't make a second API round-trip per file.
function pickCaptureDate_(meta) {
  if (meta.imageMediaMetadata && meta.imageMediaMetadata.time) {
    // EXIF format: "YYYY:MM:DD HH:MM:SS"
    const parsed = parseExifDate_(meta.imageMediaMetadata.time);
    if (parsed) return parsed;
  }
  if (meta.createdTime) {
    return new Date(meta.createdTime);
  }
  // Truly last resort (shouldn't happen — createdTime is always set).
  return new Date();
}

// EXIF dates use colons in the date portion: "YYYY:MM:DD HH:MM:SS".
// Convert to a JS Date.
function parseExifDate_(s) {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  // Note: month is 0-indexed in JS Date.
  const d = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
    parseInt(m[4], 10),
    parseInt(m[5], 10),
    parseInt(m[6], 10)
  );
  return isNaN(d.getTime()) ? null : d;
}

function getOrCreateChildFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) {
    return it.next();
  }
  return parent.createFolder(name);
}
