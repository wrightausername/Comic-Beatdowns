# Codex: Next implementation task for Comic Beatdowns Studio

**Owner direction confirmed November 21, 2026:** Make video creation feel automatic and effortless, while letting the creator correct individual comic shots visually in seconds. **This is the primary creator workflow, not an optional subfeature.**

## Repository and working branches

- Repository: https://github.com/wrightausername/Comic-Beatdowns
- **Canonical context:** [CODEX_HANDOFF.md](CODEX_HANDOFF.md), [AGENTS.md](../AGENTS.md)
- **Active full-page workflow branch:** `feature/whole-page-director-p0` in [draft PR #15](https://github.com/wrightausername/Comic-Beatdowns/pull/15), **stacked on unmerged smart-crop PR #4**. Latest verified PR head: `22369eb9f1c7508d37339a6cb67f87abd8734517`.
- Latest verified green CI on that head: [run 44955553693](https://github.com/wrightausername/Comic-Beatdowns/actions/runs/44955553693). Linux build/tests and Windows startup/FFmpeg media checks succeeded. Prior additional tests: 128 backend, 55 frontend, five Playwright browser workflows.
- Other open drafts: [PR #12](https://github.com/wrightausername/Comic-Beatdowns/pull/12) beginner Easy Mode stacked on [#11](https://github.com/wrightausername/Comic-Beatdowns/pull/11); [PR #13](https://github.com/wrightausername/Comic-Beatdowns/pull/13) packaged Windows desktop timeline on a separate branch; [PR #6](https://github.com/wrightausername/Comic-Beatdowns/pull/6) older Auto-Director overlap. **Do not assume the drafts have been merged or are installed. Do not merge without user approval.**

## Already coded in PR #15 (do not duplicate)

- Full-page screenshots can become source-preserving *virtual* ordered panel shots from conservative light-gutter detection; original files remain intact. Long/wide/tall panels can stay one panel with a narration-paced in-panel glide; ambiguous layouts have safe fallback.
- Numbered manual camera route: click 1 start → click 2 end → optionally append points 3–8; drag or keyboard-nudge markers; set movement fraction and zoom; reverse or clear; final point holds while ElevenLabs narration continues. Backend API/SQLite history, React preview, and FFmpeg rendering support the route.
- Visual corrections: crop/redraw, show more/less art, hold/pan, reorder, split/join safeguards, transitions, shot duration, preview and undo.
- **November 21 UX simplification now coded:** `VerdictAutopilot.tsx` has a single **Make my video draft** primary button, auto-enabling Autopilot when required, with optional settings collapsed. `PageShotReview.tsx` shows **1. Pick a shot → 2. Fix camera only if needed → 3. Preview or Next shot**. It surfaces the two-click path and speed slider, moves detailed tools under More controls, and has a Review full video action. `Editor.tsx` collapses the detailed timeline into an optional section. Additional CSS and tests are present. Latest CI was green.

## Locked intended creator experience

1. **Import** full comic page screenshots/PDF/CBZ and the already-generated ElevenLabs Verdict MP3/WAV. No mandatory manual screenshot cropping or coding settings.
2. **Make my video draft** should be the primary action. The normal path should not ask the creator to separately enable Autopilot, pick obscure settings, or configure a TTS engine. Show precise missing-input errors.
3. **Review** the result. Creator sees a simple ordered shot strip and the original whole page. If it looks right, move on without fiddling. If not, select the shot and **click 1 → 2 on the comic** to choose camera start/end; optionally tweak speed, more stops, and crop. No manual numeric coordinates.
4. **Preview** the shot or full draft. Keep edits reversible, never rewrite source pages, protect imported audio and captions. Creator chooses final MP4 export; **no automatic publishing**.
5. **Advanced** must remain accessible for precise timeline, split/merge, audio, captions, shot transitions, and camera tuning, but not compete with the main actions.

## Immediate engineering priorities, in order

1. **Audit and polish the simplified PR #15 journey in real Chromium tests** from fresh project through import → draft → shot correction → preview → final review. Verify a new user can find primary actions without advanced-mode navigation. Check keyboard, pointer/mouse and mobile width, save and undo, and that changing a shot does not silently replace approved edits. Avoid repeating a setting in multiple visible places.
2. **Resolve branch integration safely.** Reuse PR #4 crop engine and PR #15 route/editor; coordinate with PR #12 beginner flow and PR #13 desktop packaging instead of creating competing beginner/home screens or timelines. Preserve file/SQLite migration and dependencies. Do not mark any draft as released without packaging owner-facing build.
3. **Complete P0 Auto-Director [Issue #14](https://github.com/wrightausername/Comic-Beatdowns/issues/14).** Irregular/gutterless/inset/overlapping panel detection, reading-order correction, source panel vs shot vs narrative scene distinction, narration/script evidence for story-aware cuts, and safe pans *between* separate panels remain unfinished. Never hallucinate AI comprehension; conservative fallback with review when uncertain.
4. **Owner acceptance:** use creator-supplied full-page *Wonder Woman Vol. 2 #210* screenshots + script + ElevenLabs narration, generate actual 9:16 MP4. Measure manual corrections and time to first satisfactory preview; test on actual Windows PC after integrating with the separate packaged desktop work.

## Engineering quality and communication

- Do not reimplement existing import/DirectorService/FFmpeg/SQLite/editor. Confirm branch heads and actual tests first; use small focused commits.
- UI must be progressively disclosed: minimal default path, explicit optional corrections, advanced escape hatch. All buttons must work; avoid fake previews.
- Run `make check`, `make e2e` and Windows workflow as available; inspect green checks on the *latest tested SHA*.
- Update [CODEX_HANDOFF.md](CODEX_HANDOFF.md) and relevant PR/issue at each material milestone. **GitHub files/comments are not an automatic Codex conversation sync**; Codex must connect/select this repo and read this brief before coding.
- If no repo is visible to Codex, do not declare Comic Beatdowns absent. Connect/open this GitHub repo and inspect PR #15.

**Start instruction to Codex:** Open `wrightausername/Comic-Beatdowns`, read `AGENTS.md`, `docs/CODEX_HANDOFF.md`, and `docs/CODEX_NEXT_TASK.md`. Inspect draft PR #15 and its stacked base PR #4. Report what is already implemented and the smallest remaining blocker before creating new code. Preserve the simple workflow and the user's explicit final-approval requirement.
