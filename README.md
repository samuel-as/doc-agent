# doc-agent

[![CI](https://github.com/samuel-as/doc-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/samuel-as/doc-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![Node.js 24 portable](https://img.shields.io/badge/Node.js-24.x%20portable-5FA04E?logo=nodedotjs&logoColor=white)
![Browser: Chrome or Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285F4?logo=googlechrome&logoColor=white)
![Built for Claude Code](https://img.shields.io/badge/Claude%20Code-skills-D97757)

**Document a procedure by performing it.** You open the browser and do the process as
usual; doc-agent records every step with a screenshot, and Claude Code turns that into a
step-by-step guide in markdown — with an optional PDF.

```
you run it in the browser  →  the recorder logs steps + screenshots  →  Claude writes the doc
       (5 minutes)                        (automatic)                        (automatic)
```

No writing tutorials by hand, no cropping screenshots, no keeping docs in sync with
screens that changed: re-recording is faster.

---

## Requirements

| What | Why |
|---|---|
| Windows 10/11 | the bootstrap and the runtime are `.ps1` + `node.exe` |
| Google Chrome **or** Microsoft Edge | the recorder attaches to the browser over CDP |
| [Claude Code](https://claude.com/claude-code) | runs the `/document` and `/generate-doc` skills |

You do **not** need to install Node, npm or any dependency: on the first run the project
reuses a Node.js 22+ already installed on the machine (copied into `runtime/`) or, when
there is none, downloads the official portable Node (pinned zip from `nodejs.org`) into
`runtime/` — no admin rights, no PATH changes, no registry.

## Install

```bash
git clone https://github.com/samuel-as/doc-agent.git
```

Open Claude Code in the cloned folder. That is it — the skills are already in `.claude/skills/`.

## Usage

### Document a new procedure

Inside Claude Code:

```
/document vpn-ticket-request
```

What happens:

1. The runtime is prepared (silent when it is already fine).
2. A recording browser opens with its own profile.
3. **You run the procedure as usual.**
4. **Close the browser** to finish — the recording is consolidated and the doc is written.

On the first recording, sign in to your systems in that browser: the profile is stored in
`browser-profile/`, so later recordings start already authenticated.

### Regenerate the doc of an older recording

```
/generate-doc sessions/2026-08-19-vpn-ticket-request
```

Handy to rewrite the text without redoing the procedure — or to produce the PDF later.

### Use the CLI directly (without Claude Code)

The bundle is self-contained; only the writing of the text depends on Claude.

```bash
runtime/node.exe dist/doc-agent.mjs record vpn-ticket-request
runtime/node.exe dist/doc-agent.mjs pdf docs/vpn-ticket-request/README.md
```

## What you get

```
sessions/2026-08-19-vpn-ticket-request/   ← raw recording (local, outside git)
├── session.json                          ← consolidated steps
└── shots/step-001.png ...                ← screenshots, with the click marked in red

docs/vpn-ticket-request/                  ← generated documentation (local, outside git)
├── README.md                             ← step-by-step guide
├── img/step-01.png ...                   ← only the screenshots it references
└── vpn-ticket-request.pdf                ← optional
```

The text comes out in the imperative ("Click **Save**"), with micro-actions grouped into
logical steps — a whole form becomes one step, not ten. It is written in the **language of
the recorded screens**, so a Portuguese UI produces a Portuguese guide and an English UI
produces an English one.

## Privacy and security

The recorder was designed assuming you will walk through login screens:

- **A screen with a password field produces no screenshot.** When in doubt (inspecting the
  page failed), it takes none either.
- **Password values are never recorded** — the step keeps `value: null`.
- **A navigation leaving a password screen** has its URL recorded without `query` or
  `#fragment` (a login submit can carry a credential there) and produces no screenshot.
  The protection holds as long as the page stays the same.
- **State is per tab:** a login screen in tab A does not suppress screenshots in tab B.
- **Nothing leaves your machine through the recorder.** `sessions/`, `browser-profile/`,
  `runtime/` and the generated documentation are local and listed in `.gitignore` — only
  this project's own specs, under `docs/superpowers/`, are versioned.

Even so: **review the screenshots before sharing the documentation.** If sensitive data
shows up on a screen that is not a password screen, it will be in the image.

## Repository layout

```
.claude/skills/
├── document/         ← skill for the full flow (+ bootstrap.ps1 for the runtime)
└── generate-doc/     ← skill that writes the doc from a session
dist/doc-agent.mjs    ← recorder bundle, versioned (this is what runs on the client)
tools/recorder/       ← recorder source code, tests and smoke tests
docs/superpowers/     ← design specs and implementation plans (written in pt-BR)
```

`dist/doc-agent.mjs` is committed on purpose: it is what makes clone-and-use work without
`npm install`.

## Development

Everything lives in `tools/recorder` (there you do run `npm install`):

```bash
npm test               # unit tests (node --test), no browser needed
npm run build          # regenerates dist/doc-agent.mjs — commit the bundle along
npm run smoke          # end-to-end pipeline (requires Chrome/Edge)
npm run smoke:security # screenshot and URL suppression on password screens
npm run smoke:pdf      # PDF export
```

- Changed `src/`? Run `npm run build` and commit `dist/` in the same commit.
- To update the portable Node: edit `$NodeVersion` in
  `.claude/skills/document/scripts/bootstrap.ps1`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| "Chrome/Edge not found" | set `DOC_AGENT_CHROME` to the executable path |
| Runtime download failed | the bootstrap output has the zip link and the target folder for a manual install |
| The recording ended with no steps | the browser was closed without any recorded action — record again |
| Invalid or empty session | do not generate a partial doc: record again with `/document <name>` |

## License

[MIT](LICENSE) © Samuel Alves

The committed bundle `dist/doc-agent.mjs` redistributes compiled copies of third-party
packages — their licenses are reproduced in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (regenerated by `npm run build`).
