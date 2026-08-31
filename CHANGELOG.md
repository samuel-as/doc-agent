# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) —
versions follow [SemVer](https://semver.org).

## [Unreleased]

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
