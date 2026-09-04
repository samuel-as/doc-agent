// src/paths.js
// Where doc-agent keeps its data:
// - machine-level (runtime, browser profile): %LOCALAPPDATA%\doc-agent, overridable
//   via DOC_AGENT_HOME — same convention Playwright uses for its browser cache.
// - per-procedure (recordings, generated docs): <cwd>\docs\<slug> in the project
//   the user is documenting; versioning it is the user's call.
import os from 'node:os';
import path from 'node:path';

export function dataHome(env = process.env) {
  if (env.DOC_AGENT_HOME) return env.DOC_AGENT_HOME;
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'doc-agent');
}

export function browserProfileDir(env = process.env) {
  return path.join(dataHome(env), 'browser-profile');
}

export function runtimeDir(env = process.env) {
  return path.join(dataHome(env), 'runtime');
}

export function procedureDir(cwd, slug) {
  return path.join(cwd, 'docs', slug);
}
