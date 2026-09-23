# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) —
versions follow [SemVer](https://semver.org).

## [Unreleased]

### Added

- Container crops: every action inside a semantic container (`form`, `fieldset`, `dialog`,
  `table`, `section`…) also produces `shots/step-NNN-crop.png` with the marker; steps carry
  `screenshotCrop` and `preferred` (`crop` or `full`), and the skill opens one image per
  step. Containers larger than 60% of the viewport, or absent, keep the full screenshot.
  A container too thin to use, or whose crop would miss the clicked element (a dropdown
  overflowing a `nav`), gives way to the next semantic ancestor; a block at the edge of the
  screen keeps the 480×240 minimum by shifting inward; drags always use the full screenshot.

## [0.3.2] — 2026-09-18

### Fixed

- Plugin metadata was missing from the Claude Code plugin list: the repository had no
  `.claude-plugin/plugin.json`, so the entry showed neither author nor description. The
  manifest now exists and is the authority for name, author, description, license and the
  skill path, as the plugin reference documents.
- The marketplace entry declared the skill path without `strict: false`, which the
  marketplace reference requires when the entry is the whole definition. The path moved
  into `plugin.json` instead, so the default (`strict: true`, `plugin.json` is the
  authority) is now the correct setting.
- Both manifests point `$schema` at the published JSON Schema on schemastore.org; the
  previous URL served no schema.
- The marketplace entry gained `author`, `displayName`, `category` and `keywords`, so the
  plugin list can show who publishes it.
- The CI version gate now covers all three manifests (`package.json`, `marketplace.json`,
  `plugin.json`).

## [0.3.1] — 2026-09-18

### Added

- **Installable as a Claude Code plugin**: `.claude-plugin/marketplace.json` turns the
  repository into a marketplace, so `/plugin marketplace add samuel-as/doc-agent` +
  `/plugin install doc-agent@doc-agent` installs the skill in every project — with no
  Node and no `npx`, and picking up each new release published on `main` on its own. As a
  plugin the skill is invoked as `/doc-agent:document`.
- CI gate: the plugin version in `.claude-plugin/marketplace.json` must match
  `tools/recorder/package.json`. A release whose number did not change never reaches
  installed plugins, so the two are kept in step.

### Changed

- READMEs (EN and pt-BR): the Install section now covers the three paths — plugin,
  `npx skills add`, and clone/ZIP for machines without Node or git. CONTRIBUTING records
  that a release merge into `main` publishes to plugin users.

## [0.3.0] — 2026-09-16

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
- After a navigation the recorder waits for the new screen to be painted and the DOM to go
  quiet (300 ms, cap 1.5 s), so a page or an SPA route that renders late is captured with
  its content instead of with its spinner.
- `session.json` now declares `"schema": 2`; `isPassword` became `isSensitive` +
  `sensitiveReason`.
- New smoke `npm run smoke:dynamic` (shadow DOM + SPA settle); security smoke covers every
  sensitive category.
- `README.pt-BR.md`: the README in Brazilian Portuguese, cross-linked with the English one.

### Changed

- **Screens with a password field now get screenshots**, with the sensitive fields redacted.
  Previously the whole screenshot was suppressed.
- Bundled dependencies updated: `playwright-core` 1.62.1 → 1.63.0 (CDP) and `marked`
  18.0.11 → 18.0.13 (markdown → PDF rendering).

### Fixed

- Privacy holes in the recorder: the redaction boxes are measured at the moment of the
  capture (they used to travel in the event and could be painted over a screen that had
  already changed); an action inside an iframe gets no screenshot at all, since its
  coordinates are relative to the iframe; every capture is redacted before it reaches the
  disk, including the temporary one, which used to be written in the clear until the end of
  the recording; the shortened URL after a login no longer depends on the password field
  being visible; labels written `Telefone:` or `CPF*` are detected; the text typed into a
  `contenteditable` is never used as the step label; and a shortcut pressed with nothing
  focused no longer takes the page text as its label.
- `scrolled` survives a fill started with a click (the focus event right after used to
  clear it), and a sensitive field left empty no longer produces a "fill in" step.
- Steps come out in the order they happened: events are sorted by timestamp before
  consolidation (an event whose capture took longer used to jump ahead), and a navigation
  is timestamped when it happens instead of after the settle.

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
