---
name: generate-doc
description: Generates step-by-step documentation in markdown from a session recorded by doc-agent (folder sessions/YYYY-MM-DD-name). Use when the user asks to generate the documentation of a recording or invokes /generate-doc <session-folder>.
---

# Generate documentation from a recorded session

You are given the path to a session folder (e.g. `sessions/2026-08-19-vpn-ticket-request`).
The procedure slug is the folder name WITHOUT the date prefix (e.g. `vpn-ticket-request`).

## Language of the output

Write the documentation in the **language of the recorded screens** — the reader is
someone who will use those same systems. If the screenshots show a Portuguese UI, the
step-by-step is in Portuguese; if they show an English UI, it is in English. Button and
field names are always quoted exactly as they appear on screen, never translated.

## Process (follow in order)

1. **Validate the session.** Read `<session>/session.json`. If the file does not exist, is
   corrupted or `steps` is empty, STOP immediately and report: "Invalid or empty session —
   record it again with `/document <name>`". NEVER generate partial documentation silently.

2. **Look at every screenshot.** For each step with a `screenshot`, read the image at
   `<session>/<screenshot>` with the Read tool. The images are the source of truth about
   what the screen shows — use them to:
   - fix generic or truncated labels from the log (the real button/field text is in the image);
   - identify the real name of the screen and of the system;
   - capture messages, warnings and states that the event log does not record.

3. **Group micro-actions into logical steps.** The reader wants a guide, not a log:
   - Consecutive `fill`/`select` steps in the same form become ONE step
     ("Fill in the request form") with the sub-instructions as a list, using the most
     representative screenshot.
   - A `click` immediately followed by a `navigation` is a single step: the instruction is
     the click, and the navigation screenshot shows the result ("Screen X is displayed").
   - `enter` steps become part of the field instruction ("...and press Enter"), not a step
     of their own.

4. **Write the documentation** to `docs/<slug>/README.md`, following exactly this template:

   # <Procedure title — inferred from the session name and the screens>

   > **Goal:** <what this procedure accomplishes and when to use it>
   > **Prerequisites:** <required access/systems, inferred from the URLs and login screens>

   ## Steps

   ### 1. <Imperative instruction for the step>
   <Detail of the action. If there is a screenshot: the sentence refers to what the reader will see.>
   ![Step 1](img/step-01.png)

   ### 2. ...

5. **Copy the referenced screenshots** from `<session>/shots/` to `docs/<slug>/img/`, renaming
   them to `step-NN.png` in the order of the final steps. Do NOT copy screenshots the
   documentation does not reference.

6. **Offer the PDF.** Ask whether the user also wants the PDF version (or just generate it, if
   the original request already mentioned a PDF). If yes:
   - If `runtime/node.exe` does not exist, run first:
     `powershell -ExecutionPolicy Bypass -File .claude/skills/document/scripts/bootstrap.ps1`
   - Run: `runtime/node.exe dist/doc-agent.mjs pdf docs/<slug>/README.md`
   - Hand `docs/<slug>/<slug>.pdf` to the user.

7. **Closing note** (in your reply, one line, no drama — the documentation is internal to the
   team): remind them to review the screenshots before sharing the material outside the team.

## Style rules (mandatory)

- **Imperative mood, always**: "Click **Save**", "Fill in the **Reason** field",
  "Select **Two copies** in the **Type** field". NEVER past-tense narration
  ("the user clicked").
- Button, field and menu names in **bold**, exactly as they appear on screen (use the
  screenshots).
- Password steps: write only "Fill in the **Password** field" — the value is never in the
  log and must not be invented. The same applies to any `null` value.
- Do not invent steps that are not in the session. If the sequence looks like it has a gap
  (e.g. the screen changed with no recorded click), add "> **Note:** review this part —
  the recording may have missed an action" at the matching point.
- Values typed during the recording are EXAMPLES: generalize them in the instruction
  ("Describe the problem — e.g. _VPN is down_"), do not present them as required values.
