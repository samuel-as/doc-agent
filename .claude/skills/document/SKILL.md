---
name: document
description: Records a procedure performed in the browser and generates the step-by-step documentation automatically (markdown + optional PDF). Use when the user asks to document/record a procedure or invokes /document <procedure-name>.
---

# Document a procedure (record + generate)

You are given the procedure name (e.g. `vpn-ticket-request`). The full flow is:
prepare the environment -> record -> generate the documentation. The user only interacts
with the browser.

## 1. Prepare the environment (silent when everything is fine)

1. Run the runtime bootstrap (idempotent, fast when already installed):
   `powershell -ExecutionPolicy Bypass -File .claude/skills/document/scripts/bootstrap.ps1`
   - Finished with exit 0 -> go on.
   - Exit 1 -> show the user the script output (it contains the manual plan B with the
     exact zip link) and STOP.
2. Confirm that `dist/doc-agent.mjs` exists. If it does not, the clone is incomplete —
   ask the user to re-clone the repository and STOP.

## 2. Record

1. Note whether `browser-profile/` already exists (it decides the message in the next step).
2. Run IN THE BACKGROUND: `runtime/node.exe dist/doc-agent.mjs record <name>`
3. Tell the user: "The recording browser is open. Run the procedure as usual and
   **close the browser** when you are done." If `browser-profile/` did NOT exist, add:
   "First recording: sign in to your systems in this browser — the logins are kept for
   the next ones."
4. Wait for the background process to finish (the notification arrives on its own; do not
   keep polling its status).

## 3. Handle the shutdown

- **Exit 0**: the CLI output contains `Session ready: sessions/<folder>`. Read the
  `session.json` in that folder; if `steps` is empty, report "nothing was recorded —
  the browser was closed without any action" and STOP.
- **Exit 1**: show the CLI output to the user and STOP. Never generate documentation from
  a session that failed to consolidate. Special case: if the process died within seconds
  with an error mentioning Chrome/Edge/`DOC_AGENT_CHROME`, the machine has no supported
  browser — explain that to the user in one sentence.

## 4. Generate the documentation

Read `.claude/skills/generate-doc/SKILL.md` and follow that process from the start, using
the session you just recorded (validation, reading every screenshot, grouping into logical
steps, the template, copying the images, offering the PDF and the closing note).
