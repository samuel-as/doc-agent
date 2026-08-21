// src/recorder/launch.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_CANDIDATES = [
  process.env.DOC_AGENT_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

export function findChrome(candidates = DEFAULT_CANDIDATES) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'Chrome/Edge not found in the default locations. ' +
    'Set the DOC_AGENT_CHROME environment variable to the executable path.',
  );
}

export async function launchBrowser({ profileDir, port = 9333, headless = false }) {
  const exe = findChrome();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`, // Chrome 136+ requires a dedicated profile for CDP
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (headless) args.push('--headless=new');
  args.push('about:blank');
  const proc = spawn(exe, args, { stdio: 'ignore' });

  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) {
        const browser = await chromium.connectOverCDP(endpoint);
        return { browser, proc };
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  try { proc.kill(); } catch {}
  throw new Error(`Could not connect to the browser over CDP at ${endpoint}: ${lastErr}`);
}
