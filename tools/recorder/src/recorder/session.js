// src/recorder/session.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { consolidate } from './consolidate.js';
import { drawMarker, drawRedaction } from './marker.js';

// Local-time stamp YYYY-MM-DD-HHMM: each recording gets its own folder, so earlier
// takes of the same procedure are preserved.
function stamp(now) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export class SessionWriter {
  // procedureDir is docs/<slug> in the user's project; this recording lands in
  // sessions/<YYYY-MM-DD-HHMM>/ under it (session.json + shots/).
  constructor(procedureDir, name, now = new Date()) {
    this.name = name;
    this.dir = path.join(procedureDir, 'sessions', stamp(now));
    this.shotsDir = path.join(this.dir, 'shots');
    this.events = [];
    this.rawCount = 0;
  }

  async init() {
    // Re-recording within the same minute reuses the folder: start it clean so
    // screenshots from the previous take can't survive into the new session.
    await fs.rm(this.dir, { recursive: true, force: true });
    await fs.mkdir(this.shotsDir, { recursive: true });
  }

  async addEvent(ev, screenshotBuffer = null) {
    let screenshot = null;
    if (screenshotBuffer) {
      // Privacy invariant: pixels of a sensitive field never reach the disk, not even in
      // the temporary raw capture. A recording killed before finalize() used to leave
      // unredacted raws behind in shots/. If painting fails the capture is dropped
      // entirely — no image is better than a readable password.
      let buf = screenshotBuffer;
      const rects = ev.sensitiveRects ?? [];
      let ok = true;
      if (rects.length) {
        try { buf = await drawRedaction(buf, rects); } catch { ok = false; }
      }
      if (ok) {
        this.rawCount += 1;
        screenshot = `shots/raw-${String(this.rawCount).padStart(3, '0')}.png`;
        await fs.writeFile(path.join(this.dir, screenshot), buf);
      }
    }
    this.events.push({ ...ev, screenshot });
  }

  async finalize() {
    // Events can be appended out of chronological order: screenshot capture for
    // click/field-focus/check/shortcut/drag-start is serialized through a promise
    // chain, while enter/field-commit/drag events (no screenshot) are appended
    // synchronously and can jump ahead of an earlier event still awaiting its
    // capture. Sort by ts (stable, so same-ts events keep arrival order) before
    // consolidate() assumes array order == chronological order.
    const orderedEvents = [...this.events].sort((a, b) => a.ts - b.ts);
    const steps = consolidate(orderedEvents);
    const finalSteps = [];
    for (const step of steps) {
      const finalShot = step.screenshot ? await this._renderShot(step) : null;
      const { coords, screenshot, sensitiveRects, ...rest } = step;
      finalSteps.push({ ...rest, screenshot: finalShot });
    }
    // The raws are already redacted (addEvent), but they duplicate the final images.
    for (const f of await fs.readdir(this.shotsDir).catch(() => [])) {
      if (f.startsWith('raw-')) await fs.rm(path.join(this.shotsDir, f)).catch(() => {});
    }
    const session = { schema: 2, name: this.name, createdAt: new Date().toISOString(), steps: finalSteps };
    await fs.writeFile(path.join(this.dir, 'session.json'), JSON.stringify(session, null, 2));
    return this.dir;
  }

  // Final image of a step: the click marker on top of the already-redacted raw capture,
  // saved as shots/step-NNN.png. Returns null on any failure — one step without an image
  // must not abort the rest of the recording.
  async _renderShot(step) {
    try {
      let buf = await fs.readFile(path.join(this.dir, step.screenshot));
      if (step.coords) {
        try { buf = await drawMarker(buf, step.coords); } catch { /* a screenshot without the marker beats no screenshot */ }
      }
      const finalShot = `shots/step-${String(step.index).padStart(3, '0')}.png`;
      await fs.writeFile(path.join(this.dir, finalShot), buf);
      return finalShot;
    } catch {
      return null;
    }
  }
}
