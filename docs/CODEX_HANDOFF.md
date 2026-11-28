# Comic Beatdowns Studio: Codex handoff and current implementation status

> **Canonical project context for new Codex sessions.** This is a maintained handoff, not a claim that ChatGPT and Codex share a live conversation.  
> **Last verified:** November 27, 2026. Latest owner update: draft PR #22, named-panel organizer application source `76e31b3`; final source/check/package evidence is in the November 27 autonomy delivery entry below. Draft PRs remain unmerged; Issue #14 acceptance remains open.

## Find the actual project

- **Repository:** https://github.com/wrightausername/Comic-Beatdowns
- **Default branch:** `main`, with the existing Python/FastAPI backend, React/TypeScript/Vite Studio, FFmpeg pipeline, authenticated local database, editable scene workflow, Windows `Start Studio.cmd` launcher, and optional integrations.
- The project is a **GitHub repository**, not a ChatGPT Site. If a Codex environment shows no attached repository, **connect/open/clone this exact repository** before claiming there is no project. Check which branch is checked out.
- This status document is on `main` so it remains visible in future fresh checkouts. **Do not confuse this documentation commit with merging the feature branches.**

## Latest Codex task entry (November 21, 2026)

**Start here:** [docs/CODEX_NEXT_TASK.md](CODEX_NEXT_TASK.md). This is the owner's complete actionable handoff for the **simplest possible app workflow** and the latest P0 comic-page Auto-Director code. On draft [PR #15](https://github.com/wrightausername/Comic-Beatdowns/pull/15), `feature/whole-page-director-p0` at verified HEAD `22369eb9f1c7508d37339a6cb67f87abd8734517`, the new flow is **Make my video draft → review shot strip → fix the camera only if needed by drawing 1→2 → adjust speed → preview/next → final review**, with advanced controls collapsed. **Latest green verification:** [CI 44955553693](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/44955553693), both validate and Windows jobs green. This feature is unmerged and not yet part of an installable release; real episode testing and smarter irregular-panel detection are pending.

Do not create another unrelated flow/editor, claim Codex chat is automatically synchronized, or merge without explicit approval.

## Active PRs and implementation reality

| Area | Reference | Status with verification dates below |
| --- | --- | --- |
| Reference-video editing styles | [Draft PR #18](https://github.com/wrightausername/Comic-Beatdowns/pull/18), `feature/reference-video-style`, stacked on PR #17 | Nov 24: local reference analysis plus structure/tag mapping, pause/subtitle-aligned cuts, per-beat evidence and overrides, opt-in vision interpretation, immutable rendered proposals, versioned/portable recipes. Exact source/Windows artifact evidence is maintained in PR #18. Approximate supported effects, not arbitrary plugin reconstruction; actual owner Windows 10 acceptance remains open. |
| Combined desktop, page review and creator assistant | [PR #17](https://github.com/wrightausername/Comic-Beatdowns/pull/17), `feature/creator-assistant-workflow`, stacked on #13 | **Open DRAFT; unmerged.** Integrates #13 and current #15/#4. Pasted edit plans, timed-caption edits, review queue, approved defaults and preferred recipes. Nov 22 source `b173b69`: 155 backend / 70 frontend / 11 browser tests and Windows packaged download/native-window checks passed. Nov 23 finishing/media-quality follow-up adds revision-safe explicit approve/export and fixes silent-audio NaNs; exact latest validation/build evidence is maintained in PR #17. P0 irregular pages and actual Windows 10/11 owner acceptance remain open. |
| Creative DNA learning foundation | [PR #11](https://github.com/wrightausername/Comic-Beatdowns/pull/11), branch `feature/creative-dna-foundation` | **Open DRAFT; not merged into `main`.** Adds private SQLite learning rules, explicit owner approvals, revision-linked Keep/Fix/One-off scene feedback, observations of changed field names, view/pagination, and approved prompt rules. Does not yet autonomously learn semantic style patterns. |
| Easy Mode and novice-friendly video making | [PR #12](https://github.com/wrightausername/Comic-Beatdowns/pull/12), branch `feature/guided-studio-ux` | **Open DRAFT; stacked on PR #11 (not `main`).** Prominent Make a video entry, beginner guide, missing-material checks, less configuration, direct one-click Autopilot **preview** generation, explicit review, optional advanced editor, preference per video, recoverable existing workflows. |
| Full-page panel reading + camera traversal | [Issue #14](https://github.com/wrightausername/Comic-Beatdowns/issues/14), extending [draft PR #4](https://github.com/wrightausername/Comic-Beatdowns/pull/4) | **P0 core release requirement, first slice implemented only in [draft PR #15](https://github.com/wrightausername/Comic-Beatdowns/pull/15)**, stacked on unmerged #4. Source-preserving virtual panel shots, per-scene normalized crop, narration-paced elongated-panel glides, FFmpeg export, and manual crop edit controls are committed. **Validated at commit `249600234022d500143408430f037d8791f8c4ad`** via [Linux/browser + Windows CI](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/44935662433): 124 backend, 34 frontend, 5 browser tests, Windows media render, Ruff/Prettier/build all green.

**Nov 21 UX follow-up in draft PR #15:** Creator explicitly requested the **simplest possible app workflow**, not another settings panel. Default screen now offers one-click **Make my video draft** (auto-enable Autopilot if needed), optional AI/pacing controls collapsed, then a three-step shot review: choose shot → optionally draw 1→2 camera path and adjust speed/crop → Preview/Next/Review full video. Split/merge/transition controls and detailed timeline are collapsed behind More controls; original pages and ElevenLabs audio remain protected. Existing five-stage manual workflows remain available. UX changes are **validated on commit `22369eb9f1c7508d37339a6cb67f87abd8734517`** by [green run 44955553693](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/44955553693): 128 backend tests, 55 frontend tests, 5 Playwright browser workflows, Windows launcher and FFmpeg render all passed. Still draft/unmerged and NOT included in any existing downloadable Windows EXE; requires owner acceptance on actual comic pages.

**Nov 21 creator editing requirement, draft PR #15 only:** a visible *numbered camera-route tool*: click 1 to start, click 2 to end, optionally add points 3–8, drag or keyboard-nudge nodes, reverse/clear route, separately control pan travel time and camera closeness, and hold the final point while ElevenLabs finishes the shot. The original source remains untouched. Implemented on branch `feature/whole-page-director-p0` with Python/FFmpeg/SQLite and browser preview paths, plus UI and synthetic tests; **verified on final feature HEAD `33313d89d5756e6c2752968323f95699345ac169`: 128 backend, 52 frontend, five browser tests, and Windows startup + FFmpeg rendering green** in [run 44947386757](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/44947386757). Owner acceptance on an actual Windows PC **still required**. Creator override must remain reversible; future Auto-Director actions must preserve manually chosen paths and locked scenes. Not a shipped Windows EXE. Still NOT production-complete: irregular/gutterless detection, scene-aware camera travel between panels, intelligent speech/action matching, and real Wonder Woman owner test remain outstanding. |
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

### Editable video timeline update

The combined update branch now shows a real multi-track timeline in both Easy
Mode and the full editor, beside the existing preview. It reads the current
scene list, so saved AI-generated cuts appear immediately; it does not display
an unrelated mock timeline or infer AI provenance for manual shots. Tracks show
panel thumbnails, camera moves/transitions, timed captions, selected narration,
scene sound-effect offsets and music. Missing SFX duration is a marked event,
not a fabricated audio length. Selecting/seeking follows the browser preview.

Shot camera/transition edits, reorder, split and waveform cut timing update the
same autosaved workspace and renderer inputs. Reorder/split/cut timing protect
locked shots. Narration/caption timing is retained when rearranging artwork.
The existing Undo, detailed editor and review/export gates remain in use.
Timeline audio tracks are visible; arbitrary audio drag/trim/multitrack mixing
is not added. Rendered previews remain necessary for hearing the complete mix.
See PR #13 for exact test/build results and the updated Windows artifact.

### Direct timeline editing (CapCut-inspired interaction)

The latest update expands the timeline with draggable shot reordering,
frame-quantized left/right trim handles, snapping to cuts/playhead/captions,
keep-total-length cut rolls or explicit ripple trimming, and zoom/fit controls.
Shift/Ctrl selection supports batch locking/deletion. The toolbar exposes play,
Undo/Redo, split, duplicate, delete and lock. Focused timeline shortcuts support
Space, S, D/Ctrl-D, Delete, arrows/Shift-arrows and +/-; Ctrl-Z remains the
existing durable workspace history. Locked intervals cannot be crossed or
silently shifted. Narration and timed captions stay in place during ripple edits.

Shot controls include duration, motion/strength, framing, transitions, captions,
and favorite sound selection/offset. Timed captions have text/in/out controls.
Audio controls expose narration/SFX/music gains, music ducking, and narration
source in/out. Sound markers can be dragged within their own shot. The track
shows an actual narration waveform, empty tracks can be hidden, playback follows
the playhead and zoomed playback scrolls along the timeline. Double-clicking a
shot zooms into it. Precise narration pause/cut controls remain in a disclosure.

Browser preview now plays narration, looping music and scene sound effects and
honors their gains up to HTML audio's 100% ceiling. Browser ducking is an
approximation based on narration presence; exact speech-dependent ducking and
voice gain above 100% remain renderer behavior. Render a review copy for the
final mix. This is a sequential comic-shot editor, not arbitrary stacked video
layers, free-floating audio clips, or a complete CapCut replacement. All these
controls write existing workspace schemas and preserve review/export gates.
See PR #13 for verified commit, CI and executable provenance.


## November 22–23 creator-assistant integration — draft PR #17

Branch `feature/creator-assistant-workflow` integrates PR #13's desktop/timeline
and the current PR #15 full-page camera work (including stacked PR #4), plus
latest main documentation. No draft PR has been merged into main. Preserve
Issue #14's P0 owner-acceptance gate: conservative page detection is still
incomplete for irregular/gutterless pages, and actual Windows 10/11 owner
acceptance is not established by CI.

The current owner request excludes the installer and adds targeted fixes,
exception-only review, preferred recipes, a simpler default workspace, and
reviewable learning. The instruction box supports bounded local commands and
versioned JSON plans pasted from ChatGPT. Copy editing brief supplies exact
project/scene IDs and current revision. Optional connected writing AI requires
explicit per-request opt-in and sends text/settings/labels, never artwork or
credentials. It can interpret prose and propose rewritten script text; it does
not generate ElevenLabs audio or establish semantic/visual correctness.

Every proposal is persisted locally, previewable without mutating a project,
shows before/after fields, and needs explicit Apply. Unknown fields/code,
foreign IDs, locked shots, stale revisions, duplicate apply and rejected plans
are declined. Applied edits use existing atomic workspace save, Undo/Redo and
approval invalidation. Single-shot duration changes roll an unlocked neighbor
to retain narration timing; this extra field is visible in the proposal.

Review reuses existing preflight and current Director flags, adds missing asset
and failed-render checks, and supports timecode jumps, revision-scoped skip
reasons and previewable safe geometry/timing fixes. Review does not claim to
verify comedy, speech-balloon contents, causality or audio peaks. Preferred
recipes reuse templates, apply automatically to new episodes, and yield to an
explicitly chosen template. Repeated allowlisted settings corrections in three
different episodes can propose Creative DNA rules; those remain inert until
approved and can be disabled. Observation opt-out and erasure are provided.
This is transparent settings memory, not autonomous semantic taste learning.

Validation and executable provenance will be recorded in the feature PR. Do
not describe this combined branch as installed or production-complete merely
because it compiles. Whole-page sources, imported files and camera paths remain
in the existing models/history; no second renderer or editor is introduced.

Verified combined source `b173b698fd317444f9b82ec2a9be69c213a5b2bb`: 155
backend tests, 70 frontend tests and 11 browser workflows passed in
[validation run 45084939713](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/45084939713).
Windows startup/real vertical rendering passed. The single EXE from
[package run 45084939757](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/45084939757)
also passed actual downloaded-artifact SHA256, isolated startup and authenticated
native-window checks on separate Windows Server 2022/2025 runners. Artifact ID
14779360742 belongs to that exact source, not later changes. This is CI evidence,
not Windows 10/11 owner acceptance.

The owner's **keep pushing anything left** follow-up adds a finishing pass to
the same branch/PR, excluding installer work. `Check and export` reuses the
review queue, checks source assets and (when available) the actual full MP4 for
the exact saved revision using local FFprobe/FFmpeg. It checks dimensions,
duration, audio stream, black intervals, silence and near-zero mix peaks.
It excludes old and section renders, exposes unavailable scans and warnings,
requires explicit creator review and `Approve and export`, and queues the
existing 1080×1920 renderer atomically against the reviewed revision. Failed
queueing rolls back approval; edits require new checks. Black/silent content
can be intentional and is never automatically removed. This does not establish
artwork/caption legibility, semantic story alignment, or subjective quality.

Actual silent-audio rendering exposed FFmpeg 7.1 `loudnorm` returning nonfinite
samples, which volume/limiter/AAC could turn into a full-scale signal. The mix
now restores 48 kHz after loudnorm and replaces only nonfinite samples with zero
before subsequent mixing; finite audio is preserved. Final AAC is explicitly
48 kHz. Regression coverage decodes a real silent vertical master and confirms
silence stays silent, rather than merely asserting that FFmpeg exits zero.
The editing brief now includes the selected shot and the user's described
problem; proposals and learned defaults display readable field names. Final
follow-up check/build evidence belongs in [PR #17](https://github.com/wrightausername/Comic-Beatdowns/pull/17).

Remaining release work is not hidden by these additions: Issue #14 irregular,
gutterless/inset/overlapping reading-order/story-aware camera acceptance; more
reliable script/recording alignment with persisted evidence/confidence; approved
full-episode ready-to-post packages; creator-episode visual/audio acceptance and
actual Windows 10/11 trials. Existing offline alignment and publishing controls
are partial foundations, not proof those backlog outcomes are complete.

## November 24 reference-video style workflow

Owner asked to import a video they like, incorporate its effects/pacing into
an episode, and keep the result tweakable. Branch `feature/reference-video-style`
is stacked on the verified PR #17 head `8fbe4224050ae5eff5fbf699ad70f9641c9ff752`.
No draft is merged into main. The whole-page Issue #14 release gate and actual
Windows 10/11 owner acceptance remain open; installer work remains excluded.

The new workflow reuses `EditProposal`, the assistant's Watch/Apply/Discard
controls, atomic workspace writes, history, existing camera/transition fields,
real timeline and FFmpeg renderer. It adds an additive `reference_styles` SQLite
table and a private video route, not a second editor or compositor. Uploads are
bounded at 64 MB, demuxers/protocols are restricted, analysis samples at 10 fps
for 0.5–180 seconds, and local decoding has time/frame/dimension limits. No
reference audio/artwork is placed in the episode. Default analysis is local;
the optional explicitly consented vision workflow below can share reference frames.

Analysis measures hard visual changes, short light/dark dips, gradual blend
candidates and coarse motion cues. These are approximate and inspectable;
character/object motion can resemble camera motion. Text animation, masks,
background separation, grading, sound design and third-party plugin effects are
not reconstructed. A recipe can be edited beat by beat (hold, transition,
camera), named, saved, selected across episodes and deleted with its source.
Intensity, tempo, channel toggles and a shot range govern proposed application.

Pacing can add consecutive reframings using stable generated IDs and existing
source panels/crops, preserving source order and exact frame count. Locked
shots, custom routes and long-panel glides remain unchanged at their original
times; shot captions and sound placements retain timing. Narration, music,
logo, script, timed captions and global settings are not changed. Slow reference
rhythms cannot discard required artwork; fast rhythms respect 240 shots and
minimum duration. Style and project revisions are checked again on preview/apply;
recipe changes/deletion invalidate pending proposals. Applied edits remain
ordinary editable shots and render after reference deletion.

Validation includes synthetic original reference MP4s with actual cuts, flashes
and crossfades, immutable preview, deterministic shot IDs, locks/routes/timing,
caption/SFX preservation, stale scope/version rejection, offline privacy,
authenticated byte ranges, malformed input and lock recovery, 30-fps rounding,
240-shot capacity, exact Undo and real 1080×1920 FFmpeg rendering/decoding.
Playwright exercises actual import, recipe tweaks/save/reload, intensity,
proposal/watch/apply/Undo and reference playback. `make check`, `make e2e`,
Windows reference/media tests and downloaded-EXE/native-window checks are required;
exact final source/check/build evidence belongs in the feature PR.

### November 24 smart-style refinement

The owner's follow-up asks for a fully developed, intelligent adaptation rather
than averaged/repeating pacing. PR #18 now maps the reference's relative opening,
middle and ending positions by default, with optional loop mode and existing
hit/reveal/reaction/read scene tags. Narration pauses are measured locally and
subtitle boundaries can guide nearby cuts; these are not word-level alignment
or proof of story comprehension. Anchors and algorithm version are frozen in
the proposal, and old pending proposals retain their original compiler.

Each beat has source time/evidence, reviewed-effect flags, per-beat blend,
strength, easing, purpose and enabled controls. Unreviewed effects and white
flashes default off. Intensity scales effect strength/frequency; minimum holds,
reading protection and deterministic effect limits constrain dense references.
Dense analysis samples across the full excerpt, keeping its ending. Slower
recipes may consolidate adjacent equivalent artwork but never discard distinct
source art. A proposal explains limits and traces mapped shots to reference beats.

Optional style understanding uses the configured vision connection only after
an explicit unchecked consent box. It sends up to 18 small sampled reference
frames and the recipe, not reference audio or the creator's episode assets.
Strict bounded suggestions cannot execute code or change timing/routes, are
returned as an unsaved candidate and need acceptance/save. Evidence and
uncertainty are qualitative; unsupported effects remain clearly listed. Model
transport/validation is tested with a mock provider, not a live paid model.

The assistant can render an actual 360p proposed draft through the existing
FFmpeg queue without changing SQLite timeline state. Proposal renders are
marked in history and excluded from current-video review/approval. Apply and
Undo remain revision checked. Recipes can be copied, re-excerpted independently,
restored from 20 prior versions, and exported/imported as JSON up to 1 MiB;
backups contain neither media paths nor credentials. Shared reference video is
deleted only after its final style; legacy unreviewed effects migrate safely.

Verification adds real narration/SRT timing, editable effect rendering, exact
Undo, imported-caption preservation, dense/short/low-intensity cases, history
limits, backup roundtrip including Unicode, vision consent/rejection and the
complete browser review/render/recovery flow. Local `make check` passed 188
backend / 70 frontend tests, lint, formatting and production build; `make e2e`
passed all 14 workflows. The final trace assertions also passed in all 17 focused
intelligence tests. Final exact counts, source SHA
and Windows build/download checks are recorded in PR #18. The Issue #14 P0 gate,
actual owner Windows 10/11 acceptance and installer exclusion still apply.

### Owner download recovery (November 24)

The owner reported that temporary chat download pages do not load. The
`Share verified Windows owner preview` workflow reuses artifact 14950518478
from successful package run 45457122609, verifies the exact original EXE hash
`5537cf7fb597fa5eb8f12ee40d28e7bdd7bc367b1cbc099a73664a6bbcc5574c`, and attaches
the standalone EXE to the `studio-preview-2026-11-24` owner-trial prerelease.
It does not rebuild or change the tested source `e80ed05427b6ee564fe6e8a1c05dea1935917c44`,
merge draft PRs, or claim production/owner-PC acceptance. Prefer the fixed
GitHub release download over five-minute signed chat links. Confirm the
workflow and anonymous download before handing off that URL.

## November 24 workspace discoverability and presentation

Owner reported that new features were too hidden and requested clearer
organization and visual polish. Branch `feature/workspace-tool-discovery`
is stacked on PR #18 at `ca1d298`. It preserves the existing editor and data.

A visible Workspace tools panel exposes Add files, Make a draft, Reference
style, AI editing assistant, Video timeline, and Review & export. Camera/crops,
review queue and saved-default shortcuts are also visible. Cards open existing
sections, expand the relevant disclosure, scroll and move keyboard focus without
mutating the project. Export explains its requirement for shots before enabling.
Files come before the draft builder; shot/timeline review comes before finishing.
Reference/AI/timeline disclosures have clear titles, descriptions and icons;
spacing, contrast and responsive cards give the workspace a consistent hierarchy.
Detailed controls stay available without forcing a switch to the full editor.

Local `make check` passed 188 backend / 70 frontend tests, lint, formatting and
production build; `make e2e` passed all 15 workflows. Actual desktop/mobile
screenshots are in `docs/screenshots/workspace-tools-*.png`.

The fresh workspace EXE is pinned to application source
`b7cfd5240c8cde5e69801876a9f7ee2906b276b9`, package run `45489588848`, artifact
`14966305603`, SHA256 `65027d42f18123e2b57997fa9cc57884dc887932d2b822c6006b682f7024f08d`.
The downloaded original checksum and new UI strings inside its bundled JS were
verified locally. Download/native-window checks passed on separate Windows
Server 2022/2025 runners. The sharing workflow attaches that unchanged EXE under
`studio-workspace-preview-2026-11-24`; confirm success and anonymous full download
before handing off. Final CI/sharing evidence belongs in PR #19. The older
`studio-preview-2026-11-24` still targets the preceding layout. No installer or main merge;
Issue #14 irregular pages and owner Windows 10/11 acceptance remain open.

## November 27 quiet Windows tools, focused editing and page-order corrections

Owner reported flashing command windows, confusing editing, bad ordering/cropping
of **full comic pages**, and difficulty re-editing a built video. Branch
`fix/quiet-desktop-guided-flow` is stacked on PR #19 at `7faa0ec`.

All runtime FFmpeg/FFprobe calls now use `app.processes.run`: Windows children
receive CREATE_NO_WINDOW and disconnected stdin. Output/error capture, timeouts
and process failure behavior remain intact. Tests enforce use of that policy
throughout backend/app, verify Windows flags and actual child GetConsoleWindow=0
on Windows. Downloaded-EXE --check also executes bundled FFmpeg through that
policy. No build/terminal launcher output is globally redirected or suppressed.

Guided projects show one active work area, a compact four-step navigator and
persistent next action. New projects default guided; explicit expert preferences
remain usable. All existing tools stay mounted so switching preserves draft
inputs/proposals. Edit this draft opens saved shot corrections; Preview my changes
renders the current timeline instead of automatically rebuilding it. Simple fit,
zoom and earlier/later actions are visible. The full editor remains an escape
hatch; technical rendering/export review and explicit approval remain intact.

Local Director no longer replaces page IDs through weak tag matching. Vision
also preserves source page order by default; cross-page reassignment requires
explicit advanced opt-in for non-sequential collections. Local
gutter reading order is row-first even after a vertical split. Optional vision
responses can supply strict, bounded, evidenced panel regions; uncertain or
duplicate/out-of-page regions are rejected or kept whole. Crop focal points are
translated from page coordinates into the chosen panel; points outside that
panel retain whole-panel framing and a review warning. This uses the already
explicitly selected provider mode, with no new silent external calls.

Existing bad drafts can restore uploaded page order. Explicit one-run page
re-detection plans from original pages and clears stale generated storyboard
assignments; locked shots/custom routes block the reset, source images/narration
and captions survive, and prior scenes stay in Undo/version history. Ordinary
manual edits do not trigger this reset.

Final checks, PR and fresh owner-preview EXE provenance are recorded in the new
feature PR. Model transport/region validation use mocked providers and original
synthetic geometry. Arbitrary irregular-page semantic quality and actual owner
Windows 10 acceptance still require real-material trials; Issue #14 is not closed.

Application source for this preview: `d1e3d613c2061e2bf8480d733d86f37bf9037afa`,
draft PR #20, Windows package `45989014931`, artifact `15192402561`, EXE SHA256
`21d03a7b5cc6c4a3658760ae11238723c2212decfa5f89885d1afc295c05f35d`.
Windows passed 121 tests including a real child with no console window; downloaded
EXE startup/native-window checks passed on separate Server 2022/2025 runners.
The actual EXE's bundled JS includes Edit this draft, Preview my changes,
page re-detection/source-order recovery, and its PYZ includes app.processes.
Sharing pins those exact bytes under `studio-guided-fix-preview-2026-11-27`.
Confirm final validation `45989014858`, sharing success and anonymous public
download before handing off. The older November 24 links retain the older app.

Owner later reported still seeing **six large cards**, identifying the old
workspace layout rather than this application's four-step navigation. Identical
generic filenames made installed/Downloaded copies ambiguous. Sharing now adds
`Comic-Beatdowns-Studio-2026-11-27-Guided-Fix.exe` with the exact same tested bytes
and SHA256 above. Keep the generic asset alive for existing links; recommend the
dated file, close all older Studio windows and launch it directly from Downloads.
No application code or project data is changed by this distribution correction.

## November 27 autonomous editing workflow — stacked on PR #20

Owner approved all seven editing-assistance proposals. Branch
`feature/autonomous-editing-workflow` preserves the four-step workspace and the
existing SQLite/assets, Director, proposals, Undo and explicit export choices.

The Director now produces a persisted story report separating authored page
regions from editorial shots and spoken beats. Optional vision output can include
region-specific characters, visible dialogue, action/reaction evidence and
validated region references. Local mode leaves unknown story facts empty; it
cannot read balloons or recognize characters. New shots may follow grounded,
chronological within-page region assignments; conflicting page order stays
flagged. This does not close Issue #14 or establish real-material creative quality.

Narration reports retain real observed local recognition word times when
available, otherwise imported caption phrase boundaries. Script agreement and
misread/missing text are reported separately from acoustic confidence; no word
timestamps are invented from an SRT. Grounded action keywords can anchor cuts and
sounds; adjacent cuts roll toward phrase/pause boundaries, preserving total
frames, protected routes/glides/locks and the original recording. Dialogue and
reaction holds have minimum-time guards. Exact action alignment remains limited
by recognition or supplied timestamps and model evidence.

Every actual render now gets a local stream/decode/black/silence/peak scan. Up to
two attempts rebuild/remux technical failures; near-zero mix peaks can receive
render-only headroom and a rescan. Findings and repairs remain visible on the
render and in review. Intentional dark art/silence and uncertain creative choices
are warnings; they are not blindly removed. Repair does not rewrite the timeline
or automatically approve/publish an episode.

Sound planning rotates available installed/user-imported impacts/whooshes,
honors favorite choices and existing custom sounds, can build into a following
hit/reveal with an original synthesized riser, and leaves reactions/dialogue
clear. Existing voice normalization, ducking and adjustable mixer stay in use.
No third-party audio is fetched. Automatic sound design is a bounded one-event
per-shot system, not arbitrary layered audio composition.

The existing assistant understands bounded local sequence instructions such as
“Speed up the middle, keep the opening, let the final reaction breathe.” These
use timeline thirds (stated in the UI), add actual editable reframings and roll
the ending cut while keeping the recording, captions, total frames and protected
absolute intervals. More open-ended instructions still use the existing pasted
plan or explicitly enabled writing provider. Proposals have stable new shot IDs,
real FFmpeg previews, revision checks, Apply/Discard and Undo. Prepared wider,
longer-hold or next-artwork candidates use those same preview/apply controls;
unavailable/protected/no-op alternatives are omitted and repeat requests reuse
saved candidates.

After a saved edit in an Autopilot-enabled project, the visible, disableable
background-preview option debounces rendering. It waits for active work and
queues a revision-checked draft, never an automatic final export. Content hashes
reuse encoded shots and final camera frames, including predecessor-image/blend
and duration dependencies; captions, branding and audio are remixed each time.
Corrupt entries rebuild, incomplete writes stay private, and the local shot cache
is pruned to 1 GiB after renders. Queued/running renders resume immutable snapshots
on restart with bounded recovery; local planning resumes from saved evidence.
Unfinished remote calls are not automatically resent without a saved plan.
Newer project edits cannot be overwritten by an older resumed run.

Validation includes original synthetic page/audio fixtures, actual MP4 decoding,
sequence apply/Undo, stable previews, protected absolute intervals, candidate
staleness/deduplication, incoming-blend cache invalidation/corruption, bounded
repair and render/planning restart recovery. Full local checks, browser workflow,
Windows validation and downloaded-EXE evidence must be recorded against the final
application SHA in the feature PR before sharing a new owner build. Installer
work and actual owner Windows 10/11 acceptance remain outside these checks.

Local initial full verification passed 212 backend tests (one Windows-only skip),
70 frontend tests, lint/format/build and all 17 browser workflows. Final hardening
adds four more integration cases: observed-word anchors, inspected mix repair and
rescan, background revision/Director gates, and sound timing/truncation guards.
All 15 autonomy integration cases and the final browser autonomy workflow passed.
A fresh full `make check` and Windows/CI checks are being run on the final source;
use the forthcoming PR/run provenance rather than inferring delivery from this
entry. Actual original-fixture UI: `docs/screenshots/autonomous-editing-options.png`.

### Verified autonomy application and owner delivery

Draft PR #21: https://github.com/wrightausername/Comic-Beatdowns/pull/21,
stacked on #20. Application source `e05aa1da014ede6863556590afb5f5c93d57177d`.
Local final `make check`: 216 backend passed/one Windows-only skip, 70 frontend
passed, lint/format/production build. All 17 browser workflows passed; the final
hardened autonomy flow also passed separately. CI validation `46067314452` passed
216 backend, 70 frontend, 17 browser workflows and **136 Windows media tests**.

Package run `46067314435`, artifact `15231406731`: actual downloaded EXE
146,576,360 bytes, SHA256
`a9367748feac13c3d335cbcdbff71d789dd04155afd4304bd89e3bbd6d634298`.
Downloaded startup/authenticated-native-window checks passed on separate
Windows Server 2022/2025 jobs `140737055803` / `140737055819`.
Actual CArchive inspection confirmed bundled `/assets/index-CPF_2w3U.js` includes
background previews, story/timing reports and prepared alternatives; its PYZ
contains app.story_planning, app.sequence_edits, app.render_cache and app.processes.

The metadata-only delivery commit pins those exact bytes in the sharing workflow
under `studio-autonomy-preview-2026-11-27`, dated filename
`Comic-Beatdowns-Studio-2026-11-27-Autonomy-Preview.exe`. Verify sharing success and
a full anonymous download/hash before handing off. Older preview links stay
available; the existing downloaded app does not update itself. Close it and open
the new dated EXE from Downloads. ChatGPT's internal blank download page is not a
working transfer: use the fixed GitHub link in an external Edge/Chrome window.
No app code changes after the tested source; no main merge or installer. Actual
owner Windows 10/11 and coherent real-comic episode acceptance remain open.

## November 27 named panel organizer — stacked on PR #21

Owner requested an easier automatic crop/order workflow with persistent names
such as `ww_01A`, `ww_01B`, `ww_01C`, then the next page. Branch
`feature/named-panel-organizer` extends the existing source-preserving page engine.

A project-owned `workflow.panel_organization` stores ordered source pages,
validated Windows-safe unique page names and bounded normalized panel regions.
Stable panel references are separate from letter labels and editorial shot IDs.
Scene `source_panel_ref` / `source_label` fields migrate in place and survive
pacing, reframing, splits, saved workspaces, history and reload. Original page
images remain the scene's source; there is no mandatory pre-cropping or duplicate
library-asset creation. User-saved reading order wins over later automatic
geometry/tag choices, and a rebuild from these panels is explicit for existing
videos, with the existing locked-shot/custom-route protection and Undo.

The visual organizer groups named thumbnail crops under each page and provides
page/panel ordering, naming prefix, saved order, crop redraw/add/remove/merge and
keep-whole correction. Local geometry handles clear gutters; unknown layouts stay
whole with a specific review prompt. Save keeps existing cameras/timing intact;
build uses the reviewed layout with imported narration through the existing
Director. Shot review/timeline/assistant selectors display the same panel names.
Restoring organized order uses stable references and refuses protected or
unmatched content rather than silently sorting only by current crop coordinates.

The optional authenticated ZIP download contains actual original-resolution PNG
crops grouped as `ww_01/ww_01A.png`, etc. It also supports one saved page at a
time; bounded pixels/bytes and safe validated names prevent oversized or invalid
archives. Original stored files stay unchanged. Preview/save are revision checked,
repeat detection reuses source-derived references, and stale/foreign/duplicate/
out-of-page layouts are rejected. This is an organization improvement; it does
not close Issue #14's irregular-page/story-aware camera/real-owner Windows gate.

Initial integration verification: named PNG bytes match their source regions,
source hashes remain unchanged, local full-page detection and deterministic names,
real FFmpeg video from saved reading order, label preservation under auto-edit and
workspace saves, protected-shot metadata changes, stable-reference reorder and
exact Undo. Full checks, browser desktop/mobile workflow, Windows media/package
checks and a uniquely named owner preview are required before delivery; record
exact final application source/run/hash evidence in the feature PR.

Local initial full check passed 221 backend tests (one Windows-only skip), 70
frontend tests, lint/format/build and all 18 browser workflows. Final hardening
adds correct tall-crop thumbnail proportions, a visible Organize panels shortcut,
metadata handling for merged/replaced panels and a further assistant-reference
integration case. All six organizer integration cases, the ten editing unit
cases and final desktop/mobile organizer + workspace-discovery browser flows
passed. Final full checks and Windows build evidence follow in the feature PR.
UI screenshots: `docs/screenshots/named-panel-organizer.png` and mobile variant.

### Verified named-panel application and owner delivery

Draft PR #22: https://github.com/wrightausername/Comic-Beatdowns/pull/22,
stacked on #21. Application source `ce79d986f99c9f8073fe2b94eab1e992fd3551f6`.
Final local `make check`: **222 backend passed**, one Windows-only skip,
**71 frontend passed**, lint/format/build. All 18 browser workflows passed, with
final organizer desktop/mobile and discovery flows checked again after hardening.
CI push validation `46079241005` and PR validation `46079272458` passed for that
same application source: 222 backend, 71 frontend, 18 browser and **142 Windows
media tests**. No installer or main merge.

Package `46079272477`, artifact `15236975376`: actual downloaded EXE
146,600,309 bytes; SHA256
`2647d1a10886e165b0c47ef452ad5acd166dbf0f94cb10429507ef439e30f23b`.
Downloaded startup/authenticated-native-window checks passed on separate Server
2022/2025 jobs `140775027907` / `140775027919`. Actual CArchive/PYZ inspection
confirmed `/assets/index-S3ITL2IW.js`, the organizer/build/download/order controls,
app.panel_organization and the existing planning/cache/sequence/quiet modules.

The metadata-only sharing commit pins those exact bytes under
`studio-panel-organizer-preview-2026-11-27`, dated filename
`Comic-Beatdowns-Studio-2026-11-27-Panel-Organizer.exe`. Verify sharing success and
a complete anonymous public download/hash before handoff. Existing preview URLs
stay valid, and old installed EXEs do not update themselves. Close older Studio
windows, then launch this dated file from Downloads. Use an external Edge/Chrome
window if ChatGPT's internal download tab is blank. Actual owner Windows 10/11
and irregular/real-comic creative acceptance remain open under Issue #14.

Final audit found that an explicit rebuild from an earlier automatic local crop
plan could keep that plan instead of taking new Vision panel regions. The
follow-up fix re-detects on explicit rebuild only when the layout was not
creator-saved. Two staged Basic → Vision integration cases verify both refinement
of automatic crops and preservation of the creator's accepted layout. This
supersedes the first organizer preview; final source/package evidence follows.

### Corrected named-panel preview — final source

The rebuild fix is verified at **`76e31b321f10aed13d73b58a18bad44a48c0f914`**.
Final local `make check` passed **224 backend tests** (one Windows-only skip),
**71 frontend tests**, lint/format/build; final `make e2e` passed all **18 browser
workflows**, including desktop/mobile cropping, save/reload and actual draft
construction. CI `46080146866` passed those same checks plus **144 Windows media
tests**. Eight organizer cases now include explicit automatic-layout refinement
and protection of the creator's saved layout under staged Basic → Vision rebuilds.

Package `46080151734`, artifact `15237306349`: **146,600,776 bytes**, SHA256
`fc7b057a97a2bbbf0bffa17ac3fc90ccb0395ed90e266afabbc0644453282545`.
Downloaded startup/native-window checks passed on Server 2022/2025 jobs
`140777937941` / `140777937974`. The original downloaded artifact hash and actual
bundled organizer/autonomy UI/backend modules were inspected again. Frontend
entry remains `/assets/index-S3ITL2IW.js`; the changed Director is in the new PYZ.

Final sharing pins those exact bytes under `studio-named-panels-preview-2026-11-27`,
filename **Comic-Beatdowns-Studio-2026-11-27-Named-Panels.exe**. It supersedes the
first `studio-panel-organizer-preview-2026-11-27` trial, whose link is retained.
Confirm sharing and complete anonymous download/hash before delivery. Later
metadata-only commits do not change the tested application source. Issue #14 and
actual owner Windows 10/11/real-comic acceptance remain open; no installer/main
merge or automatic publishing was added.

## November 27 follow-up — production deletion and Windows download fallback

Branch `feature/production-trash`, stacked on draft PR #22. The owner requested
production deletion while reporting another blank ChatGPT download page. The
previous public named-panels EXE still returns a full anonymous 200/MZ download;
that server-side result does not establish that the owner's ChatGPT path works.
Do not present the same link alone as a resolution.

Adds a visible Delete production action on every desk card and in the open
workspace. Confirmation explicitly moves the production to Trash; Trash and
Restore stay visible on the production desk. This is reversible deletion, not a
disk cleanup: narration, original shared panels/sounds, scenes, edit history,
versions and exports remain local and intact. Trash is excluded from active
productions, export lists and inbox watching, and standard edit/build/preview
routes reject hidden productions. Restore retains the folder-watching preference
and changes the revision so stale requests cannot overwrite restored work.
Delete reserves the DB writer and render enqueue lock; active Director jobs or
renders must finish before deletion. No real owner production was deleted.

Nine isolated lifecycle tests pass, covering source hashes, narration/shots/history
and export preservation, another production, stale revisions, repeated deletion,
active Director/render states, hidden edit/build routes and paused/restored inbox.
The existing legacy upgrade test also checks the additive nullable timestamp.
A browser workflow covers cancellation, desk deletion, reload, Restore, editor
confirmation/deletion and phone-width restore. Full local and Windows checks,
packaging and delivery verification are pending at this milestone.

`scripts/download-owner-preview.ps1` downloads only a fixed public release URL,
checks the expected SHA256, saves through a temporary file and never starts the
EXE or changes execution policy. A dedicated Windows 2022/2025 workflow exercises
built-in Windows PowerShell 5.1 and checksum failure preservation. This is a
browser-independent fallback; it does not claim ChatGPT itself has been repaired.
Record the final new source/run/file/hash and public transfer checks below before
delivering a new owner preview. Issue #14 and actual owner Win10/11/real-comic
acceptance remain open; no installer, main merge or automatic publication.

Browser audit caught lifecycle dialogs being mounted in the signed-out layout
instead of the authenticated workspace; corrected before preview delivery. Dialog
headings now provide accessible names through `aria-labelledby`. The focused
end-to-end delete/cancel/restore test passes after the correction (desktop and
390px mobile). Initial full check passed 233 backend tests (one Windows-only
skip), 71 frontend tests, lint/format/build; a full browser run was intentionally
stopped after the audit finding. Rerun full checks at the corrected source.
Public-download workflow `46086071291` passed built-in Windows PowerShell 5.1
transfers and checksum-failure preservation on both Server 2022/2025, using the
previous public EXE. Repeat against the new preview after packaging/sharing.

### Make a draft validation failure — reproduced and corrected

Owner reported the generic “Check the form fields and try again” specifically
in Make a draft. A real Chromium reproduction created a normal production,
imported a page and external narration, then clicked Make my video draft. The
Autopilot settings PUT returned 422 `extra_forbidden` at `body.voice_approved`
with `input:false`. `touch(..., invalidate_approval=True)` legitimately stores
this server-owned flag; the client incorrectly spread it back into the strict
editable request when enabling Autopilot (or switching final delivery to draft).

The client now explicitly selects editable Autopilot fields. Crop rebuild and
page-reorder choices are retained when changing another setting. Server-owned
approval is never submitted as an editable field; the strict backend remains
unchanged. The same page/narration → first draft reproduction now builds a real
FFmpeg preview. Validation details name the actual field and constraints,
including numbered shot/page paths, instead of discarding the server's list.
Draft failures appear beside the draft button, retain uploads/edits, and clear
when retrying. Missing server details are described honestly; unknown request
settings are identified as app compatibility errors rather than user mistakes.

API/draft unit checks cover structured validation, missing fields, nested shots,
revision/unknown fields, unreadable responses, readonly approval filtering,
retained crop/order choices and visible inline retry. Browser regression also
injects a specific invalid pacing response, checks actionable inline guidance and
preserved uploads, then retries through the real server to a rendered preview.
Re-run final checks and package at this corrected source; the earlier deletion
build `5a27e892f115a0f1f3909119f325e9604bb03eda` is superseded for owner delivery.

### Verified combined application — final source and delivery preparation

Final application source **`db47965b3e0b870f99ea1a1f11a6ededa5f58552`**. Local
`make check` passed **233 backend tests** (one Windows-only skip), **77 frontend
tests**, lint/format/build. Final `make e2e` passed all **20 browser workflows**,
including the actual first-draft 422 reproduction/fix, specific inline validation
and safe retry to a real FFmpeg preview, plus desktop/mobile delete/restore.

Windows package **`46087066098`**, artifact **`15239173815`**: original EXE
**146,601,013 bytes**, SHA256
`d2a5ae52dd60f08ccb7c25757a11b6c7c04bb61b9f50ed7df4417a8278ce8624`.
Actual downloaded startup/native-window checks passed on Server 2022/2025 jobs
`140799783099` / `140799783113`. Downloaded CArchive/PYZ inspection confirms
`/assets/index-B2nikuZJ.js`, specific draft-error/Trash/Restore UI, the absence of
the old generic form-fields string, and existing organizer/autonomy/quiet modules.
Windows media validation for this source passed; push/PR Linux browser validation
is finishing in `46087061321` / `46087066040`. Record final CI/media count below.

Metadata-only sharing pins those same tested bytes under
`studio-draft-fix-preview-2026-11-27`, dated filename
**Comic-Beatdowns-Studio-2026-11-27-Draft-Fix.exe**. A release metadata entry is
precreated with authenticated `gh release create` because the Actions token's
release-creation path previously returned 403; asset upload stays in Actions.
Sharing now runs Windows PowerShell 5.1 public transfers on 2022/2025, including
the exact copy/paste download-only command documented in windows-desktop.md.
Confirm sharing, these new public checks and a complete anonymous download/hash
before delivering. No expiring artifact URL is an owner delivery link.
Later metadata-only commits do not change the tested application source. Actual
owner Win10/11/real-comic acceptance and Issue #14 remain open; drafts stay unmerged.


### Combined preview delivery completed

Application-source push validation **`46087061321`** and PR validation
**`46087066040`** both passed: 233 backend tests (one Linux Windows-only skip),
77 frontend tests, 20 browser workflows and **153 Windows media tests**. Package
`46087066098` and its separate downloaded-EXE checks are green at the same source.

Sharing **`46087571827`** passed. The exact new public EXE was downloaded and
SHA256-verified with Windows PowerShell 5.1 on Server 2022/2025 jobs
**`140800791831` / `140800791849`**. Both also passed the exact copy/paste owner
command in Windows Downloads. These commands download only and do not execute
the EXE or change execution policy. Earlier run `46086071291` separately tested
wrong-checksum rejection while preserving a previous good download.

A complete **anonymous public GET** returned 200, `application/octet-stream`, the
correct dated attachment filename, **146,601,013 bytes** and SHA256
`d2a5ae52dd60f08ccb7c25757a11b6c7c04bb61b9f50ed7df4417a8278ce8624`;
the public SHA256.txt matches both filename and tested artifact. This fixed URL
is the owner download, not the short-lived signed workflow-artifact URI:
https://github.com/wrightausername/Comic-Beatdowns/releases/download/studio-draft-fix-preview-2026-11-27/Comic-Beatdowns-Studio-2026-11-27-Draft-Fix.exe

The PowerShell fallback bypasses ChatGPT's blank download page; it is not evidence
that ChatGPT's browser behavior itself has been repaired. Close older Studio
windows and open the dated Draft-Fix EXE from Downloads. Existing productions
remain in the same local profile. Draft PR #23 stays stacked on #22 and unmerged.
Actual owner Windows 10/11 and real-comic creative acceptance still remain open
under Issue #14. Later documentation-only commits do not alter the packaged source.

## November 27 follow-up — printed-panel cropping only

Owner narrowed the immediate task: full comic pages → one crop per printed panel,
in reading order; large/wide/tall panels stay whole. Narration-to-action matching
and camera planning are deferred for this task. No CapCut control is connected.
The actual owner page files are on their Windows PC, not in this workspace; one
full page has been requested for real-material verification. Do not claim their
specific comic is fixed from synthetic fixtures or publish another preview as
owner-accepted without checking their material.

Branch `fix/full-page-panel-crops`, stacked on draft PR #23. Local detection used
to require almost-white wide gutters and stopped after two layout levels. It now
accepts thin light/aged-paper and uniform dark separators, refines at original
resolution (including balloon-tail protection), and recursively follows complete
separators up to six levels / 24 printed panels. A large/tall panel without an
internal separator remains one crop; no narration-based or camera-sized slicing.
Irregular/inset/overlapping layouts without reliable separators still need review;
Issue #14 remains open. Existing source files are not rewritten during cropping.
The library's pre-existing JPEG normalization on import is unchanged; exact PNG
crop tests compare against the stored source raster and verify its hash survives.

The organizer exposes **Auto-crop full pages** even for an older cached layout;
it now actually re-detects instead of just re-opening the old whole-page result.
Saved creator layouts/unsaved changes get confirmation before replacement preview;
video shots/timing remain intact until an explicit build/order operation. Whole-
page fallbacks are labelled “whole page · check boundaries.” Save and PNG download
are the primary cropping actions; no narration or video build is required.

Focused verification: 23 existing detector/page/camera/story-flow cases pass.
Six new backend cases cover thin/aged/JPEG/dark nested layouts, intact large/tall
panels, single large artwork, exact named PNG pixels/reading order/source hashes,
and read-only re-detection of a cached whole-page fallback. Two real-browser
workflows pass, including no-narration crop/save/ZIP download and mobile layout.
Full `make check`, `make e2e` and Windows validation/package checks follow at the
committed source. Actual owner page acceptance is still pending their upload.
