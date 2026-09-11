# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) —
versions follow [SemVer](https://semver.org).

## [Unreleased]

### Added

- Recorder captures checkbox/radio changes (`check`), keyboard shortcuts with a modifier
  (`shortcut`; Ctrl+C/V/A/Z ignored) and drag & drop (`drag`, with the drop target).
- Steps carry `scrolled: true` when the user scrolled more than half a viewport since the
  previous action on the same page; the guide says "Scroll down to … and click …".
- Clicks inside shadow DOM (`composedPath`) and on role-less elements with a pointer cursor
  are recorded.
- Sensitive-field detection beyond `type=password`: `autocomplete` tokens, multilingual
  field names (Portuguese included), CPF/CNPJ check digits and Luhn for cards. Values are
  never stored; fields are painted over in screenshots.
- After a navigation the recorder waits for the DOM to go quiet (300 ms, cap 1.5 s), so SPA
  route changes are captured after they render.
- `session.json` now declares `"schema": 2`; `isPassword` became `isSensitive` +
  `sensitiveReason`.
- New smoke `npm run smoke:dynamic` (shadow DOM + SPA settle); security smoke covers every
  sensitive category.

### Changed

- **Screens with a password field now get screenshots**, with the sensitive fields redacted.
  Previously the whole screenshot was suppressed.

## [0.2.1] — 2026-09-04

### Changed

- Bundled `marked` updated from 15.x to 18.x (markdown → PDF rendering).

## [0.2.0] — 2026-09-04

The repository now works both cloned and installed as a skill
(`npx skills add samuel-as/doc-agent`) from any project.

### Added

- `SECURITY.md` with GitHub private vulnerability reporting as the disclosure
  channel, and Dependabot configuration for weekly npm and GitHub Actions
  update PRs.

### Changed

- Single self-contained `/document` skill replaces the `document` + `generate-doc`
  pair. `/document <new-name>` records and generates; `/document <existing-slug>`
  regenerates; `/document` with no argument asks which mode, listing existing
  recordings. The recorder bundle moved from `dist/` into the skill
  (`.claude/skills/document/scripts/doc-agent.mjs`).
- Machine-level data moved out of the repository into `%LOCALAPPDATA%\doc-agent`
  (override with the `DOC_AGENT_HOME` environment variable): the portable Node
  runtime (downloaded once per machine, not per project) and the recording
  browser profile.
- Everything produced for a procedure now lives in `docs/<slug>/` in the project
  where `/document` runs: `README.md`, `screenshots/` (was `img/`), the optional
  PDF, and one `sessions/<YYYY-MM-DD-HHMM>/` folder per recording (earlier takes
  are preserved). doc-agent does not touch the host project's `.gitignore` —
  versioning the output is the user's decision.
- The skill folder is now legally self-contained: it carries `LICENSE.txt` and
  the generated `THIRD-PARTY-NOTICES.md` (moved from the repo root), so the
  bundled third-party licenses travel with the bundle on `npx skills add`.

## [0.1.0] — 2026-08-31

First public release.

### Added

- `/document <name>`: records a browser procedure (steps + screenshots via CDP)
  and generates the step-by-step markdown guide, with optional PDF.
- `/generate-doc <session>`: regenerates documentation from a recorded session.
- Zero-install runtime: the bootstrap reuses a system Node.js 22+ when present, or
  downloads the pinned portable Node from nodejs.org — no admin, no PATH changes.
- Privacy guards: no screenshots on password screens, password values never
  recorded, URLs stripped of query/fragment on navigations leaving a login page.
- Committed self-contained bundle (`dist/doc-agent.mjs`) with third-party license
  attribution (`THIRD-PARTY-NOTICES.md`) regenerated on every build.
