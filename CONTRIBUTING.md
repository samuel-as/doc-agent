# Contributing

Thanks for your interest in improving doc-agent! This is a small project — the rules
below are everything you need.

## Where the code lives

| Path | What it is |
|---|---|
| `tools/recorder/` | recorder source, tests and build — the only place you run npm |
| `.claude/skills/document/` | the skill: SKILL.md, `references/write-doc.md`, `scripts/bootstrap.ps1`, LICENSE.txt |
| `.claude/skills/document/scripts/doc-agent.mjs` | committed bundle, **generated** — never edit by hand |
| `.claude/skills/document/THIRD-PARTY-NOTICES.md` | **generated** by the build — never edit by hand |

## Setup

```bash
cd tools/recorder
npm ci
npm test
```

The unit tests run with `node --test` and need no browser.

## The golden rule: the bundle travels with the source

The bundle at `.claude/skills/document/scripts/doc-agent.mjs` is committed on purpose —
it is what makes both `npx skills add` and clone-and-use work without `npm install`. If
you touch `tools/recorder/src/`, run `npm run build` and commit the bundle and
`THIRD-PARTY-NOTICES.md` **in the same commit**. CI rejects any change where they drift
from the source.

## Before opening a PR

1. `npm test` — all green.
2. `npm run build` — and commit the generated output along.
3. Optional, needs Chrome or Edge installed:
   `npm run smoke`, `npm run smoke:security`, `npm run smoke:pdf`.

## Scope notes

- The project is Windows-only by design (`bootstrap.ps1` + portable `node.exe`).
  PRs adding other platforms are welcome, but open an issue to discuss first.
- Keep `bootstrap.ps1` compatible with Windows PowerShell 5.1 (no `&&`, no ternary,
  no `?.` — it must run on a stock Windows 10 machine).
- New recorder behavior should come with a unit test in `tools/recorder/tests/`.
