# Comic Beatdowns Studio: Codex handoff and current implementation status

> **Canonical project context for new Codex sessions.** This is a maintained handoff, not a claim that ChatGPT and Codex share a live conversation.  
> **Last verified:** November 15, 2026. Recheck PR heads, issues, and CI before making decisions.

## Find the actual project

- **Repository:** https://github.com/wrightausername/Comic-Beatdowns
- **Default branch:** `main`, with the existing Python/FastAPI backend, React/TypeScript/Vite Studio, FFmpeg pipeline, authenticated local database, editable scene workflow, Windows `Start Studio.cmd` launcher, and optional integrations.
- The project is a **GitHub repository**, not a ChatGPT Site. If a Codex environment shows no attached repository, **connect/open/clone this exact repository** before claiming there is no project. Check which branch is checked out.
- This status document is on `main` so it remains visible in future fresh checkouts. **Do not confuse this documentation commit with merging the feature branches.**

## Active PRs and implementation reality

| Area | Reference | Status as verified Nov 15, 2026 |
| --- | --- | --- |
| Creative DNA learning foundation | [PR #11](https://github.com/wrightausername/Comic-Beatdowns/pull/11), branch `feature/creative-dna-foundation` | **Open DRAFT; not merged into `main`.** Adds private SQLite learning rules, explicit owner approvals, revision-linked Keep/Fix/One-off scene feedback, observations of changed field names, view/pagination, and approved prompt rules. Does not yet autonomously learn semantic style patterns. |
| Easy Mode and novice-friendly video making | [PR #12](https://github.com/wrightausername/Comic-Beatdowns/pull/12), branch `feature/guided-studio-ux` | **Open DRAFT; stacked on PR #11 (not `main`).** Prominent Make a video entry, beginner guide, missing-material checks, less configuration, direct one-click Autopilot **preview** generation, explicit review, optional advanced editor, preference per video, recoverable existing workflows. |
| One-click episode roadmap | [Issue #5](https://github.com/wrightausername/Comic-Beatdowns/issues/5) | Open. Build on existing Studio/Director/renderer. Do not recreate them. |
| Adaptive Creative DNA roadmap | [Issue #8](https://github.com/wrightausername/Comic-Beatdowns/issues/8) | Open. Automatic learning proposals, feedback quality, and first-pass acceptance measurement still future work beyond PR #11. |
| Audience Intelligence roadmap | [Issue #10](https://github.com/wrightausername/Comic-Beatdowns/issues/10) | Open. Official authorized platform connectors and comment/retention analysis **not yet implemented**. |

PR #12 final tested commit (as of this handoff): `07e7d5ecf10d9ea7cc104e06a333efaf0338b729`. [CI run](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/43684002334): **115 Python tests, 38 frontend unit tests, 6 browser end-to-end workflows, Windows launcher and real vertical FFmpeg rendering passed**. This is build/test evidence, not proof of first-pass creative quality with actual copyrighted comics. PR #11 also had a successful CI run. Re-run CI for new commits.

**Do not merge PR #12 into main before PR #11**; #12 currently targets the Creative DNA branch. Review conflicts and older draft PRs #4 and #6 before integrating overlapping feature areas. Do not represent an open PR as an installed release.

## Locked owner decisions

- App name: **Comic Beatdowns Production Studio**, an eventually standalone **Windows .exe**. Current launcher is `Start Studio.cmd` and runs a local browser UI; **there is no distributable packaged .exe yet**.
- Narrator: **Verdict**, an irreverent comic-fan commentator, not a factual recap bot. Roasts must be grounded in exactly what happens in the panels and be lore-aware. Humor: dry, surprisingly mean, loose/organic conversational frustration; unhinged character nicknames can escalate after establishing the actual names, but avoid generic AI similes, joke templates, excessive profanity, or fabricated lore. The user has final editorial control.
- Default Shorts target: **~65–90 seconds, vertical 9:16**. Natural seamless loop from ending into opening when possible. Support long-form independently.
- **ElevenLabs stays the voice tool.** The user will generate Verdict's narration in ElevenLabs and import the resulting **MP3/WAV**. Prioritize frictionless imported narration, alignment to panels/captions, clear timing and replacement warnings. **Do not spend development cycles on competing built-in TTS/voice cloning.** Optional future official ElevenLabs API is separate and only by permission; never assume credentials or silently charge.
- Ideal creator workflow: **idea and authorized panels → Verdict script → ElevenLabs narration import → automated panel matching/crops/shot planning/captions/edit/preview → creator freely revises → explicit final export**. The existing first-cut automation requires panels and narration; it does **not** magically create everything from an idea yet.
- User wants **minimal clicks and near-first-pass success**; use a simple guided interface and bury technical settings behind Advanced, without hiding errors, losing editable scenes, or skipping approval. Never guarantee a mathematically impossible 100% acceptance rate.
- Any learned preferences must be transparent, local/privacy-preserving by default, reversible, and subject to explicit approval for global rules. Owner instructions outrank audience sentiment; comments/engagement are evidence, not commands.
- Do **not** auto-publish, use unofficial scraping, claim unknown analytics, or publish copyrighted panels without proper permissions. Existing publishing tools require separate approvals.

## Current capabilities vs unfinished work

**Implemented on `main` before active PRs:** panel/PDF/CBZ import and original-preserving crop, manually editable shots, captions/SRT, narration import, timed motion and transitions, local audio mix, FFmpeg draft/final rendering, undo/redo and versions, local keyword matching and optional Vision AI, basic Verdict Autopilot, approval-gated export, publishing desk connections, private operator authentication, `Start Studio.cmd`.

**Implemented only in PR #11:** Creative DNA rules, evidence capture and page as above.

**Implemented only in stacked PR #12:** Easy Mode guided creation and direct preview-first Autopilot as above.

**Not yet implemented as a verified feature:** full AI episode script/audio/panel orchestration from idea alone; high-quality voice creation inside the app (not desired because ElevenLabs remains external); fully autonomous learning of creator corrections; production social comment and retention sync via official APIs; self-improving evidence-backed postmortems; packaged installable `.exe`; validated creative acceptance on real episodes.

## Concrete next steps for Codex

1. **Confirm repo and branch**: `wrightausername/Comic-Beatdowns`; pull the latest `main`, inspect PRs #11/#12 and related CI. Avoid writing into an unrelated attached Site/workspace.
2. **Review and integrate stacked PRs safely**: check tests, overlap with existing features, security and concurrency, fix review findings, obtain merge approval. Preserve existing DB, user assets, saved videos and edit histories.
3. **Polish ElevenLabs import in Easy Mode**: label the missing input **“Add ElevenLabs narration (MP3/WAV)”**, preserve exact timing where possible, offer replacement with visible warnings about changed cuts/captions, and make common errors actionable. Make this a small tested PR; do not build a new TTS engine.
4. **Deliver genuine Windows installability**: build and smoke-test Windows packaged app/installer, durable data under a user-writable app directory with safe migration from existing `.data`, FFmpeg bundling/licensing review, no repeated developer toolchain download. Do not claim availability before verifying an artifact.
5. **Improve AI first-pass creative quality**: inspect repeated user corrections, generate *proposals* for style rules, version/approve/undo them; validate on original/test material; measure first-pass acceptance without gaming the metric.
6. **Audience Intelligence**: only official permissioned APIs supported for each platform; attach results to exact published video revision; show missing data as unavailable; let the owner approve any suggested style changes.
7. Always implement **the smallest end-to-end tested slice**. Add tests, leave precise PR status/comments, and keep this file updated after **material verified changes**.

## Continuity and communication protocol

- This document and `AGENTS.md` are **handoff references**, not proof of an active Codex task or an automatically synchronized Codex chat.
- For a Codex cloud task, **select or connect the repository** and explicitly include: `Read AGENTS.md and docs/CODEX_HANDOFF.md, inspect PRs #11/#12, then report implemented/partial/missing before changes.`
- After each material coding milestone, update the relevant PR and this document with **what shipped, what remains, latest tested commit, and truthful CI result**. Do not assert updates happen continuously if no agent or scheduled monitor is running.
- If asked for a status and no repo is mounted, use the exact GitHub repo link rather than saying no Comic Beatdowns project exists. Ask to attach the GitHub repo only when Codex itself cannot access it.


## Combined update branch (November 15, 2026)

`update/studio-desktop-easy-mode` combines the existing Creative DNA (#11),
Easy Mode (#12), and `feature/windows-desktop-exe` branches without changing main.
The canonical handoff and existing owner decisions are retained. Older crop and
one-click intake PRs (#4/#6) remain separate; their overlapping intake paths were
not merged into this update.

The update includes the native Windows shell, one-use local login, persistent
`%LOCALAPPDATA%\ComicBeatdownsStudio` storage, bundled media tools, and a Windows
portable-archive packaging workflow. ElevenLabs remains external: Easy Mode now
explicitly asks for MP3/WAV narration and replacing editor narration warns about
retiming existing cuts and captions. No autonomous style learning or audience
analytics has been added. Existing data migration remains a manual, backed-up
copy with Studio closed; see `docs/windows-desktop.md`.

Validation of this combined branch is recorded in its PR. Do not infer a passing
Windows build or downloadable artifact from the existence of the packaging code.

### Download failure follow-up

The owner reported a Python DLL load error on Windows 10 after downloading the
first portable build. Archive inspection confirmed `_internal/python312.dll`
and VC runtime DLLs were present; the specific missing dependency/extraction
cause has not been established. The earlier build-machine smoke test was
insufficient validation of the download experience.

The revised package uses one executable and removes the nested ZIP. CI now
retrieves the uploaded artifact on separate Windows 2022/2025 runners, verifies
its hash, removes developer tools from PATH, and tests backend startup and a
native authenticated WebView2 window. Windows 10 and 11 remain explicit targets,
with clean desktop compatibility still requiring actual OS testing. See PR #13
for exact build results; do not hand out an artifact whose download checks fail.
