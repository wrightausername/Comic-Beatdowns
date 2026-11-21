# Comic Beatdowns Studio: Codex handoff and current implementation status

> **Canonical project context for new Codex sessions.** This is a maintained handoff, not a claim that ChatGPT and Codex share a live conversation.  
> **Last verified:** November 21, 2026 (repo/PR context; feature CI noted by commit). Recheck PR heads, issues, and CI before making decisions.

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
| Full-page panel reading + camera traversal | [Issue #14](https://github.com/wrightausername/Comic-Beatdowns/issues/14), extending [draft PR #4](https://github.com/wrightausername/Comic-Beatdowns/pull/4) | **Owner-approved requirement, NOT implemented**: one complete-page screenshot → detect ordered panels → plan crop/hold or camera travel across the *original page* in sync with ElevenLabs narration. PR #4 offers partial straight-gutter smart crops, not a finished reading-order camera. |
| CapCut-inspired editable desktop timeline and bundled Windows EXE | [PR #13](https://github.com/wrightausername/Comic-Beatdowns/pull/13), branch `update/studio-desktop-easy-mode` | **Open DRAFT; unmerged**. Verified 118 Python, 47 frontend, 8 browser tests; Windows Server 2022/2025 packaged EXE tests passed in [Actions run](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/43742946951). [Build artifact](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/43742946951/artifacts/14172972069) expires 2026-11-29. Real Windows 10/11 owner testing remains pending. |
| One-click episode roadmap | [Issue #5](https://github.com/wrightausername/Comic-Beatdowns/issues/5) | Open. Build on existing Studio/Director/renderer. Do not recreate them. |
| Adaptive Creative DNA roadmap | [Issue #8](https://github.com/wrightausername/Comic-Beatdowns/issues/8) | Open. Automatic learning proposals, feedback quality, and first-pass acceptance measurement still future work beyond PR #11. |
| Audience Intelligence roadmap | [Issue #10](https://github.com/wrightausername/Comic-Beatdowns/issues/10) | Open. Official authorized platform connectors and comment/retention analysis **not yet implemented**. |

PR #12 final tested commit (as of this handoff): `07e7d5ecf10d9ea7cc104e06a333efaf0338b729`. [CI run](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/43684002334): **115 Python tests, 38 frontend unit tests, 6 browser end-to-end workflows, Windows launcher and real vertical FFmpeg rendering passed**. This is build/test evidence, not proof of first-pass creative quality with actual copyrighted comics. PR #11 also had a successful CI run. Re-run CI for new commits.

**Do not merge PR #12 into main before PR #11**; #12 currently targets the Creative DNA branch. Review conflicts and older draft PRs #4 and #6 before integrating overlapping feature areas. Do not represent an open PR as an installed release.

## Locked owner decisions

- App name: **Comic Beatdowns Production Studio**. `main` still uses `Start Studio.cmd` and a local browser UI; **draft PR #13 produced a portable Windows EXE artifact** (Windows Server CI verified, not yet merged or desktop-PC approved). Do not conflate the unmerged test artifact with a stable release.
- Narrator: **Verdict**, an irreverent comic-fan commentator, not a factual recap bot. Roasts must be grounded in exactly what happens in the panels and be lore-aware. Humor: dry, surprisingly mean, loose/organic conversational frustration; unhinged character nicknames can escalate after establishing the actual names, but avoid generic AI similes, joke templates, excessive profanity, or fabricated lore. The user has final editorial control.
- Default Shorts target: **~65–90 seconds, vertical 9:16**. Natural seamless loop from ending into opening when possible. Support long-form independently.
- **P0 RELEASE-BLOCKING CORE REQUIREMENT:** Full-page comic import, authored-panel reading order and intelligent camera direction are the differentiator and **must be finished before Auto-Director or one-click episodes are considered production-ready**. See [Issue #14](https://github.com/wrightausername/Comic-Beatdowns/issues/14) for hard gates and sample tests. Single long/tall/wide panels stay together; editorial shots and narrative scene transitions are distinct. Camera tracks ElevenLabs narration, avoids gutters and preserves speech balloons. Standard pages require **no manual pre-snipping**. Existing preview-only partial automation can still be tested, but must be labeled incomplete.
- **Whole-page comic flow is a priority requirement.** Creator supplies an entire page screenshot, not pre-cut panels. Verdict must infer panel order, intelligently choose crop, hold, or camera move on the original page, and align to external ElevenLabs narration; offer editable numbered overlays, fallback when ambiguous, and preserve speech-balloon readability. **CRITICAL distinction: one elongated/wide/tall/irregular authored panel is still one source panel; editorial shots/camera paths and narrative scene transitions are separate layers.** A wide composition may have an internal guided pan or several camera shots but must not be split just for its geometry. Two neighboring comic panels may belong to one continuous action and do not automatically require a dramatic transition. Switch scene/transition only when the scripted/audio/visible narrative beat warrants it. Show Keep as one / Split / Merge / Reorder overrides. Test wide-spanning panels, tall-spanning panels, splash pages, continuous adjacent action, and ambiguous gutters. **Issue #14** has exact acceptance criteria; the full experience is **unimplemented** and PR #4 is partial groundwork.
- **ElevenLabs stays the voice tool.** The user will generate Verdict's narration in ElevenLabs and import the resulting **MP3/WAV**. Prioritize frictionless imported narration, alignment to panels/captions, clear timing and replacement warnings. **Do not spend development cycles on competing built-in TTS/voice cloning.** Optional future official ElevenLabs API is separate and only by permission; never assume credentials or silently charge.
- Ideal creator workflow: **idea and authorized panels → Verdict script → ElevenLabs narration import → automated panel matching/crops/shot planning/captions/edit/preview → creator freely revises → explicit final export**. The existing first-cut automation requires panels and narration; it does **not** magically create everything from an idea yet.
- User wants **minimal clicks and near-first-pass success**; use a simple guided interface and bury technical settings behind Advanced, without hiding errors, losing editable scenes, or skipping approval. Never guarantee a mathematically impossible 100% acceptance rate.
- Any learned preferences must be transparent, local/privacy-preserving by default, reversible, and subject to explicit approval for global rules. Owner instructions outrank audience sentiment; comments/engagement are evidence, not commands.
- Do **not** auto-publish, use unofficial scraping, claim unknown analytics, or publish copyrighted panels without proper permissions. Existing publishing tools require separate approvals.

## Current capabilities vs unfinished work

**Implemented on `main` before active PRs:** panel/PDF/CBZ import and original-preserving crop, manually editable shots, captions/SRT, narration import, timed motion and transitions, local audio mix, FFmpeg draft/final rendering, undo/redo and versions, local keyword matching and optional Vision AI, basic Verdict Autopilot, approval-gated export, publishing desk connections, private operator authentication, `Start Studio.cmd`.

**Implemented only in PR #11:** Creative DNA rules, evidence capture and page as above.

**Implemented only in stacked PR #12:** Easy Mode guided creation and direct preview-first Autopilot as above.

**Not yet implemented as a verified feature:** automatic full-page reading order and across-page continuous camera travel (Issue #14); full AI episode script/audio/panel orchestration from idea alone; high-quality voice creation inside the app (not desired because ElevenLabs remains external); fully autonomous learning of creator corrections; production social comment and retention sync via official APIs; self-improving evidence-backed postmortems; an installable/signed publicly released Windows app (though PR #13 has a CI-tested portable EXE); validated creative acceptance on real episodes.

## Concrete next steps for Codex

1. **Confirm repo and branch**: `wrightausername/Comic-Beatdowns`; pull the latest `main`, inspect PRs #11/#12 and related CI. Avoid writing into an unrelated attached Site/workspace.
2. **Review and integrate stacked PRs safely**: check tests, overlap with existing features, security and concurrency, fix review findings, obtain merge approval. Preserve existing DB, user assets, saved videos and edit histories.
3. **Polish ElevenLabs import in Easy Mode**: label the missing input **“Add ElevenLabs narration (MP3/WAV)”**, preserve exact timing where possible, offer replacement with visible warnings about changed cuts/captions, and make common errors actionable. Make this a small tested PR; do not build a new TTS engine.
4. **Complete Windows deployment validation**: inspect draft PR #13's verified portable EXE and [Windows artifact](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/43742946951/artifacts/14172972069); test on the owner's Windows 10/11 desktop, verify migration and FFmpeg licensing, then package/sign an installer if required. Do not claim main has an EXE release.
5. **Build full-page reading-order Auto-Director from Issue #14**: review PR #4 before touching crop APIs, keep original page + normalized panel coords, add ordered panel overlays, page-to-panel shot planner, meaningful continuous pan/keyframe controls in current renderer, and editable fixes in existing timeline. Verify with one complete-page screenshot and ElevenLabs audio; avoid a parallel editor or fake AI understanding.
6. **Improve AI first-pass creative quality**: inspect repeated user corrections, generate *proposals* for style rules, version/approve/undo them; validate on original/test material; measure first-pass acceptance without gaming the metric.
7. **Audience Intelligence**: only official permissioned APIs supported for each platform; attach results to exact published video revision; show missing data as unavailable; let the owner approve any suggested style changes.
8. Always implement **the smallest end-to-end tested slice**. Add tests, leave precise PR status/comments, and keep this file updated after **material verified changes**.

## Continuity and communication protocol

- This document and `AGENTS.md` are **handoff references**, not proof of an active Codex task or an automatically synchronized Codex chat.
- For a Codex cloud task, **select or connect the repository** and explicitly include: `Read AGENTS.md and docs/CODEX_HANDOFF.md, inspect PRs #4/#11/#12/#13 and Issue #14, then report implemented/partial/missing before changes.`
- After each material coding milestone, update the relevant PR and this document with **what shipped, what remains, latest tested commit, and truthful CI result**. Do not assert updates happen continuously if no agent or scheduled monitor is running.
- If asked for a status and no repo is mounted, use the exact GitHub repo link rather than saying no Comic Beatdowns project exists. Ask to attach the GitHub repo only when Codex itself cannot access it.

