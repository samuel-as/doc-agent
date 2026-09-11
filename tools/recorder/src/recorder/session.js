// src/recorder/session.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { consolidate } from './consolidate.js';
import { drawMarker } from './marker.js';

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
      this.rawCount += 1;
      screenshot = `shots/raw-${String(this.rawCount).padStart(3, '0')}.png`;
      await fs.writeFile(path.join(this.dir, screenshot), screenshotBuffer);
    }
    this.events.push({ ...ev, screenshot });
  }

  async finalize() {
    const steps = consolidate(this.events);
    const finalSteps = [];
    for (const step of steps) {
      let finalShot = null;
      if (step.screenshot) {
        finalShot = `shots/step-${String(step.index).padStart(3, '0')}.png`;
        let buf = await fs.readFile(path.join(this.dir, step.screenshot));
        if (step.coords) {
          try { buf = await drawMarker(buf, step.coords); } catch { /* a screenshot without the marker beats no screenshot */ }
        }
        await fs.writeFile(path.join(this.dir, finalShot), buf);
      }
      const { coords, screenshot, ...rest } = step;
      finalSteps.push({ ...rest, screenshot: finalShot });
    }
    for (const f of await fs.readdir(this.shotsDir)) {
      if (f.startsWith('raw-')) await fs.rm(path.join(this.shotsDir, f));
    }
    const session = { name: this.name, createdAt: new Date().toISOString(), steps: finalSteps };
    await fs.writeFile(path.join(this.dir, 'session.json'), JSON.stringify(session, null, 2));
    return this.dir;
  }
}
