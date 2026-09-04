---
name: document
description: Records a procedure performed in the browser and generates step-by-step documentation with screenshots (markdown + optional PDF). Also regenerates the documentation of a previous recording. Use when the user asks to document, record or capture a procedure, process, tutorial or walkthrough done in the browser, wants a step-by-step guide with screenshots, asks to regenerate or rewrite the doc of an earlier recording, or invokes /document.
compatibility: Windows 10/11 with Google Chrome or Microsoft Edge installed
license: MIT — see LICENSE.txt in this skill folder; bundled third-party licenses in THIRD-PARTY-NOTICES.md
---

# Document a browser procedure

One skill, two modes: **record** a new procedure (browser recording + doc generation)
or **regenerate** the documentation of an existing recording. Everything doc-agent
produces for a procedure lives in `docs/<slug>/` inside the current project:

- `README.md`, `screenshots/` and the optional PDF — the generated guide;
- `sessions/<YYYY-MM-DD-HHMM>/` — one folder per recording (`session.json` + `shots/`),
  so earlier takes are preserved.

## Paths used below

- `<home>` = the `DOC_AGENT_HOME` environment variable if set, otherwise
  `%LOCALAPPDATA%\doc-agent`. Holds machine-level data: `<home>\runtime\node.exe`
  (portable Node) and `<home>\browser-profile\` (the recording browser's logins).
- Script paths are relative to this skill's directory. In Claude Code,
  `${CLAUDE_SKILL_DIR}` resolves to it; in other agents, resolve them from wherever
  this SKILL.md was read.

## 0. Decide the mode

Look at the argument the user passed (`/document <argument>`):

- Argument given and `docs/<argument>/sessions/` exists in the project →
  **regenerate**: read `references/write-doc.md` and follow it for that procedure.
- Argument given and no such folder → treat it as the name of a new procedure →
  **record** (section 1).
- No argument → ask the user (one question, options): record a new procedure, or —
  if `docs/*/sessions/` folders exist — regenerate one of them (list the procedure
  names as options). Then proceed accordingly.

## 1. Prepare the environment (silent when everything is fine)

1. Run the runtime bootstrap (idempotent, fast when already installed):
   `powershell -ExecutionPolicy Bypass -File "${CLAUDE_SKILL_DIR}/scripts/bootstrap.ps1"`
   - Exit 0 → the output ends with the full path of `node.exe` (after "at"). Use that
     LITERAL path in every later command instead of rebuilding it from variables — a
     static path avoids permission friction.
   - Exit 1 → show the user the script output (it contains the manual plan B with the
     exact zip link) and STOP.

## 2. Record

1. Note whether `<home>\browser-profile\` already exists (it decides the message below).
2. Run IN THE BACKGROUND, using the node.exe path printed by the bootstrap:
   `"C:/...literal path.../node.exe" "${CLAUDE_SKILL_DIR}/scripts/doc-agent.mjs" record <name>`
3. Tell the user: "The recording browser is open. Run the procedure as usual and
   **close the browser** when you are done." If the profile did NOT exist, add:
   "First recording: sign in to your systems in this browser — the logins are kept for
   the next ones."
4. Wait for the background process to finish (the notification arrives on its own; do
   not keep polling its status).

## 3. Handle the shutdown

- **Exit 0**: the CLI output contains `Session ready: docs/<slug>/sessions/<stamp>`.
  Read the `session.json` in that folder; if `steps` is empty, report "nothing was
  recorded — the browser was closed without any action" and STOP.
- **Exit 1**: show the CLI output to the user and STOP. Never generate documentation
  from a session that failed to consolidate. Special case: if the process died within
  seconds with an error mentioning Chrome/Edge/`DOC_AGENT_CHROME`, the machine has no
  supported browser — explain that to the user in one sentence.

## 4. Generate the documentation

Read `references/write-doc.md` and follow that process from the start, using the
session you just recorded (validation, reading every screenshot, grouping into logical
steps, the template, copying the images, offering the PDF and the closing note).
