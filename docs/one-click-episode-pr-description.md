Implements **M0 and M1 only** of #5: the existing NewProject dialog now offers a compact **Verdict · Auto-Director** recipe and one **Create preview** action after authorized artwork, exactly one narration recording, and optional reviewed TXT/MD/SRT are ready. Main remains unchanged; M2–M4 are deferred.

### Audit and dependency decision

The [M0 architecture note](https://github.com/wrightausername/Comic-Beatdowns/blob/feature/one-click-episode-m0-m1/docs/one-click-episode-m0-m1.md) records the pre-code audit, reuse/extend/new table, exact components/routes, lifecycle diagram and rollback strategy. This branch starts at reviewed main `a84d2bd`. Draft Smart Crop PR #4 remains separate and unmerged: no page segmentation, crop review, provider-confidence fallback or timeline preflight code was copied. Its PanelDetail work is separate from this NewProject change.

### Reused and extended

- Reuses NewProject, guessKind, upload ordering, the validated private per-file importer, AutopilotOptions, DirectorService, preview/approval/render queues and the existing editor.
- Adds UTF-8 TXT/MD source-script import, a read-only **source-input** eligibility endpoint, compact role/readiness controls and a shared extraction of the existing Vision connection form.
- Keeps one created project and an accepted-file ledger inside the open dialog, skips successful uploads on retry, guards repeated submits, and follows an already-started handoff rather than submitting another job. The existing editor is the recovery path.
- Adds explicit Vision authorization bound to the public endpoint/model/speech-model descriptor. Enqueue and worker startup reject changed providers without sending artwork. Legacy API calls remain compatible; credentials are neither exposed nor included in the descriptor.

### Safety and compatibility

Preview-first, fast pacing and Verdict hosting are the recipe defaults. Basic remains local and explicitly does not understand artwork. Missing narration blocks production: script-to-voice is not implemented. The 65–90-second target is advisory, never an automatic trim. Source wording import does not approve the video.

No SQLite schema/migration changes. Existing projects/templates, immutable render snapshots, source assets, scene locks, Undo/history and Before Verdict Autopilot versions are preserved. Renderer, workspace/history and publishing implementations are unchanged. Cloudinary/Buffer submission remains an independent explicit action; Create preview does not call publishing.

### Validation

- Local make check: **113 backend tests, 40 frontend tests**, Ruff, Prettier, TypeScript and production build passed.
- All **6 desktop/mobile Playwright workflows** passed; final compact mobile layout was also rerun.
- Real **75-second** three-original-panel draft verified with FFprobe, full recording/captions retained, saved-source hashes unchanged and Undo verified. Existing approved 1080p export tests remain green.
- Existing Windows startup/media workflow now includes the intake tests. See this branch's Validate studio run for native Windows/Linux results.
- Vision/speech providers are mocked; paid/live provider compatibility and artistic match quality are unverified.

### Deferred (not claimed complete)

**M2:** durable refresh/cross-tab resume and create/start idempotency; the M1 upload ledger lasts only while this dialog stays open. Saved projects/files remain available after refresh.

**M3:** consume reviewed PR #4 for one prioritized exception queue and revision-checked deterministic fixes. No competing QA or crop implementation here.

**M4:** streamline final handoff and add optional local effort metrics. Existing explicit approval/final export/publishing continue to work, but the full 75-second M4 exception-review/final-export acceptance is not implemented by this slice.

Draft for code review. Do not merge or close #5 yet.
