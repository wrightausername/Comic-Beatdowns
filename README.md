# Comic Beatdowns Studio

A private, browser-based production desk for **Comic Beatdowns**, hosted by **Verdict**. Import authorized comic sources, catalog and crop panels, write a sharp commentary script, arrange a vertical timeline, upload narration, and render a downloadable **1080 × 1920 MP4** with FFmpeg. No paid API credentials are required.

## Quick start

### Windows: download and double-click

1. Download the repository ZIP from GitHub (**Code → Download ZIP**) and choose **Extract All**.
2. Open the extracted folder and double-click **Start Studio.cmd**.
3. Let the first-time installation finish. Windows may request installation permission for Python 3.12, Node.js, or FFmpeg. Your browser opens after the studio is ready. Copy the private access token shown in the launcher window into the sign-in screen.

Keep the launcher window open while using the app. Run the same file next time; installed dependencies are reused. Installation uses Windows Package Manager (`winget`), included with Microsoft's **App Installer** on current Windows 10/11 systems. If it is unavailable, install/update App Installer from the Microsoft Store first. The launcher does not disable PowerShell execution policies or package/TLS verification. Windows CI verified launcher setup, authenticated startup, and actual MP4 rendering on Windows Server 2022 with Python 3.12, Node 22, and FFmpeg. CI preinstalls those tools; automatic installation through winget on a clean Windows 10/11 PC remains unverified.

**Updating an existing Windows installation:**

1. Stop Studio with **Ctrl+C** in its launcher window. Back up your existing Studio folder.
2. Download and extract the [latest ZIP](https://github.com/wrightausername/Comic-Beatdowns/archive/refs/heads/main.zip).
3. Copy the **contents inside** the new extracted folder into your existing Studio folder. Choose **Replace files** when Windows asks. Keep the existing `.data` folder and `.env` file; your panels, projects, exports, and access token live there. Do not delete your existing Studio folder.
4. Double-click **Start Studio.cmd** in the existing folder. It rebuilds the updated app and upgrades existing scene records automatically. Refresh the browser with **Ctrl+F5**.

### Terminal setup

Requirements: **Python 3.11+** (tested on 3.12), **Node 22+**, npm, and **FFmpeg + FFprobe** with the `libx264` encoder and `subtitles`/libass filter. The following Make commands use a Unix-style shell; Linux is the validated development platform.

```bash
# Debian / Ubuntu, if media tools are missing:
sudo apt-get update
sudo apt-get install -y ffmpeg fonts-dejavu-core python3-venv

# From the existing repository checkout:
make setup
make run
```

With the server running, `make doctor` verifies the built frontend, authenticated database API, access control, and FFmpeg availability without printing credentials.

Open port **8000** in your local browser. The backend serves the built React application and API from one origin. On first launch a random access token is written to `.data/.studio-token` with owner-only permissions. Run `make token` **locally** to view it, then paste it into the studio sign-in screen. Keep this token private. The setup script never prints it.

For development with hot reload, use two terminals from the repository root:

```bash
make api   # FastAPI on port 8000
make ui    # Vite on port 5173, proxying /api to FastAPI
```

Stop other servers before running browser tests, which own ports 8000 and 5173. Cloud tasks are already isolated: use the existing checkout; no extra Git worktree is necessary. Cloud onboarding does not supply public localhost preview links.

## Make your first beatdown

1. **Add files:** choose **New project** and drop panels, narration, music, effects, and SRT captions together. Check each file’s role. After creating the project, the **Add files** step offers the same drop zone and your project panel tray. Existing material is available through **Choose from library**. Use the Panel library to record characters/fight tags and crop pages without replacing their originals.
2. **Match narration:** write the script or import/generate timed captions. Click **Suggest panel matches**, check the line cards, select panels and moments, then **Use these assignments**. Caption timestamps are preferred; script-only timing is clearly marked as estimated.
3. **Edit:** choose Fast cuts or Smooth holds, tick the jobs you want, then **Build My Draft**. Preview proposed shots and **Accept selected suggestions**. Keep a shot unchanged with **Lock**. Use **Hit / Reveal / Reaction / Read Panel**, **Aim camera**, **Replace panel**, **Split**, **Duplicate**, and sound favorites on each scene. Detailed timing, camera, caption, script, and settings controls remain accessible below.
4. **Review:** render a review copy and watch it in this workspace. **Safe areas** shows approximate platform overlays. **Check Loop** repeats the final three seconds into the opening three. Add timestamped notes, fit narration with one click, save named versions, compare their previews, and duplicate an episode for reuse. Review the script and approve it after the final changes.
5. **Export:** export a 360p draft or approved 1080 × 1920 final MP4. Expand **Preview only a section** to render selected seconds. Downloads use names such as `Batman_vs_Bane_Final_v012_a1b2c3.mp4`. The Production desk’s **Export queue** renders multiple approved projects in sequence. Previous exports remain available in the project and Exports view.

The duration target is advisory; short clips and videos up to 180 seconds are allowed. The in-browser preview approximates motion, transitions, timed captions, logo placement, and the selected narration range. Review the actual MP4 for final caption appearance and the audio mix. A looping script ending is supported by the writing workflow and repeat playback; automatic crossfading from the final scene back to the first is not implemented.

### Make editing effortless

1. **Auto Edit:** expand **Auto Edit · pacing and excerpt options**, add panels and narration, choose **Fast · punchy** or **Slow · smooth**, then **Create first cut**. Fast defaults to roughly 1.25-second shots with punch-ins, reframing, mostly hard cuts, and occasional short slides. Slow defaults to roughly five-second shots with smoother moves and crossfades. Adjust average shot length before generating. Panels stay in story order, and repeated shots of each panel stay together. Auto Edit uses nearby narration pauses for cut placement; it does not identify faces, impacts, or semantic links between speech and panels. Review close-ups and scene choices.
2. **Independent length choice:** either pace can use **Full narration** or **Short · first 30 seconds or less**. Short deliberately selects an excerpt, ending near a pause within the last two seconds where available. The selected in/out points are shown in **Narration track** and can be adjusted or reset with **Use full narration**. Preview, captions, and export respect the selection. Unselected narration is preserved on disk.
3. **Autosave and undo:** title, idea, script, timeline, settings, and timed captions save together after about 0.9 seconds without an edit. **All changes saved** confirms a database save. Invalid values and connection errors show a failure banner. Unsaved browser drafts can be recovered after reopening a project. **Undo/Redo** stores up to 50 states in SQLite, including scene sound-effect associations and project assets. Ctrl+S saves; Ctrl+Z / Ctrl+Shift+Z work outside text inputs. Native text undo stays available while typing. Concurrent edits from another window produce a conflict instead of overwriting that window's changes.
4. **Bulk editing and timing:** select scenes or **Select all**, choose motion, transition, duration, or strength, then **Apply to selected**. **Fit narration** distributes the selected recording across the current scenes. Click the narration waveform to seek; drag a cut handle to adjust its two neighboring scenes without changing total duration. Focus a cut and use arrow keys for one-frame adjustments, or Shift+Arrow for five frames.
5. **Automatic captions:** **Generate captions** runs a bundled, offline English PocketSphinx recognizer. No account, GPU, API key, or separate model download is required. It produces short timed phrases for review. This lightweight recognizer can mishear names, accents, noisy recordings, and comic terminology; correct text and timing before production. Import an existing UTF-8 SRT for more accurate externally prepared captions, edit cues, and download the saved SRT. Cue times refer to the original narration and are shifted automatically for excerpts. Timed cues take priority over scene captions. Punchy styling emphasizes the last word of each phrase.
6. **Voice-led audio:** enable narration loudness normalization and choose narration, music, and sound-effect levels in **Settings**. Upload background music; it loops to the timeline length. Automatic ducking lowers music and effects during speech, and a final limiter controls peaks. These settings are applied in exported previews and final MP4s; the browser's audio players play the original tracks.
7. **Fast draft exports:** **Draft preview** renders at **360 × 640** using smaller intermediate frames. It works before script approval. Final **Render MP4** remains **1080 × 1920** and requires approval after changes. Drafts and final exports are labeled in history and filenames. All exports capture a fixed saved revision.
8. **Reusable brand kits:** templates now preserve editing pace, camera defaults, transition settings, caption style/size/colors/position, logo placement/size, the logo image, music track, and audio levels. New projects reuse the assets and reset narration in/out points. Upload assets you are authorized to use.

### Script performance cues and Emotion Timeline

Studio can now import a UTF-8 `.txt` or `.md` script from the **Verdict script** tab, or you can paste dialogue directly. Write explicit stage directions inline, such as:

```text
[DISBELIEF, ESCALATING] He actually outran death?!
[PAUSE 0.8s, DEADPAN] And Captain Cold is supposed to stop him?
[FRUSTRATED] With a COLD GUN?
```

In the **Verdict emotion timeline** (visible in the Script and Timeline tabs), supported bracketed or parenthetical directions become clickable timeline markers. The timeline recognizes disbelief, frustration, shouting, sarcasm, deadpan, whispers, escalation, emphasis, and timed pauses. It leaves unrecognized bracketed text untouched. Expand **Spoken dialogue only** to see the script without recognized stage directions before you record it.

Markers align approximately to the text of imported/transcribed timed captions when a majority of the spoken words match; otherwise timing is estimated from the dialogue length. You can adjust marker seconds manually. Those timing overrides autosave with the episode, survive reloads, and participate in undo/redo.

Choose **Apply camera cues to unlocked shots** to translate directions into conservative holds, punch-ins, or pushes. Every affected scene remains editable; scene length, panel selection, spoken narration, and locked shots remain unchanged. Applying cues does not synthesize speech, insert a real pause into a recording, or claim perfect alignment. Preview and approve the result before exporting. Optional AI analysis is separate, and stage directions are never treated as instructions to alter the source dialogue.

### One-Click Episode (M0/M1, review-first)

Use **Create episode → Verdict · Auto-Director** for the existing Studio's one-screen intake. Select authorized artwork (images/PDF/CBZ), exactly one Verdict narration recording, optional reviewed UTF-8 TXT/MD script and SRT captions. Confirm file roles, choose **Basic local** or explicitly authorize your configured **Vision AI** provider, then press **Create preview**. The new recipe defaults to fast pacing and draft delivery; templates and pace live under **Advanced settings**. The supplied recording is kept; 65–90 seconds is advisory. A script alone cannot start production: voice synthesis is not implemented.

Staged file checks are provisional. Imports use the existing validated per-file endpoint (64 MiB per file; 65 MiB request ceiling with form overhead, up to 20 selected files), followed by read-only source eligibility against the saved revision. Duplicate selections, missing voice and invalid media have actionable errors. Script/SRT differences are heuristic review notices, not verified audio alignment. On an error, the dialog retains the created project and accepted upload ledger; retry skips accepted files or **Open saved project in editor** provides recovery. This ledger does not survive a browser refresh; use the dashboard's saved project after reloading. Durable intake resume and idempotency are M2.

Basic makes no provider calls and does not understand artwork. Vision requires a configured image-capable model, explicit authorization naming its endpoint/model and possible speech upload/costs, and a matching provider descriptor at enqueue and worker startup. Saving a connection does not authorize sending files. Keys stay private. Provider failures never silently switch to Basic. Live provider compatibility and creative accuracy remain unverified.

The existing director builds the edit and a 360×640 review copy, including captions when available, then returns to the existing editor/Autopilot card. Existing explicit final approval, 1080×1920 export, source preservation, Undo/version history and separate Publishing Desk permissions are unchanged. Create preview never calls Cloudinary/Buffer. Existing auto-final controls remain separately opt-in in the project's Autopilot card.

See the [M0 audit and M1 contract](docs/one-click-episode-m0-m1.md) for the reuse/gap table, lifecycle and rollback strategy. Smart Crop/technical preflight [PR #4](https://github.com/wrightausername/Comic-Beatdowns/pull/4) remains separate and unmerged; this intake does not copy its segmentation, crop review or timeline QA. M2 orchestration/resume, M3 exception review/fixes, and M4 final-handoff metrics are deferred to reviewed follow-up PRs.

### Verdict Autopilot: panels + voice → video

1. Click **Verdict Autopilot** on the production desk. Drop panels and one narration recording into the new-project window. Choose Basic or your saved Vision AI connection, Fast or Slow pacing, and preview or automatic final delivery. Check the file roles and create the project.
2. Verdict analyzes voice timing, arranges shots, applies punchy camera moves and clean transitions, places local sound effects, normalizes narration, adds timed captions when speech is recognized, and renders a vertical preview. Keep Studio running; the browser can be closed. **Fast / Slow** controls pacing independently of the recording length; Autopilot keeps the full selected recording, up to 180 seconds.
3. Watch the result in the Autopilot card. Check **I checked the preview…**, then **Approve & export 1080p**. Choose **Finish for me · automatic 1080p MP4** before starting to delegate approval and get the final file automatically. Nothing is posted to social media.

For an existing project, switch on Autopilot above the five editing steps, then use **Let Verdict handle it**. Successful file batches uploaded through **Add files** trigger it automatically when both panels and narration are present. A partial/failed batch does not start a run. Manual library imports and watched-folder imports still need **Let Verdict handle it** after loading their changes. The editor, scene locks, captions, and manual adjustments remain available. Your local unsaved draft is never silently replaced. Changes during planning stop that plan from being applied; rerun on the new saved revision. Each applied run has Undo and a reusable **Before Verdict Autopilot** version. One planner runs at a time, with a bounded queue of five jobs; video rendering retains its separate bounded queue.

**Basic (default)** runs locally without API keys. It uses narration timing, your panel order, metadata tags, and keyword beat rules. It cannot understand artwork or guarantee a panel matches the spoken fight. English recognition can mishear comic names; upload an SRT for exact wording. If no speech can be recognized, Verdict produces the video without captions and explains why. An existing script is preserved; an empty script is filled only from recognized words.

**Vision AI (optional)** sends resized panel images and narration text to an OpenAI-compatible image-capable model to choose panel matches, hit/reveal/reaction/read beats, and crop targets. Open **Optional: connect Verdict’s vision AI**, enter the API base URL, model, and optional key, save, and choose **Vision AI**. Local servers such as Ollama can use `http://localhost:11434/v1` with no key; remote providers require HTTPS and may charge for usage. A separate optional **Speech model** sends narration audio to `/audio/transcriptions` and must support `verbose_json` segment timestamps. Blank uses offline English recognition; supplied SRT captions bypass speech recognition. Selecting Basic never calls these providers. Vision supports at most 30 project panels per run, validates all chosen panel IDs and coordinates, and fails visibly on unusable responses instead of quietly switching modes. No new dialogue or narration is generated.

Connection secrets are saved atomically in `.data/.verdict-provider.json`, outside media routes; API responses and job snapshots never return the key. POSIX files use private permissions; Windows inherits the data folder’s ACL. Remove the saved connection/key using its GUI button. Keep the data folder private and preserve it when updating. The existing optional script-writer environment settings are separate from this vision connection.

Autopilot jobs survive browser navigation. Restarting Studio stops an unfinished planning job with a retry message; an interrupted render follows the renderer’s existing recovery rules. Cancel is available during planning; a queued render continues through the existing export workflow. A failed provider request leaves the saved edit unchanged. AI suggestions still need judgment for continuity, names, dialogue readability, and framing. Unit/integration tests mock remote vision/speech providers, including invalid panel IDs and authentication failure; **live provider compatibility and output quality have not been verified with paid credentials**. Automated tests render real preview/final MP4 files from original generated images and silence, including Windows validation in GitHub Actions.

### Camera and transition controls

- **21 camera options:** hold, push in, pull back, four directional pans, four diagonal drifts, four moving pushes, two moving pulls, quick punch in/out, a gentle breathing zoom, and a decaying impact shake.
- **12 transitions:** hard cut, crossfade, dips to black/white, four directional slides, two soft slides, and two wipes. Each scene can inherit the project default or override it.
- **Adjustable motion:** 2–30% movement strength, four easing curves, and horizontal/vertical framing. Use 18–26% with ease-out for punchy shots, or 6–12% with smooth easing for longer holds. Framing selects the part of a wide/tall panel retained by the vertical crop.
- **Short blends:** choose 0.08–0.8 seconds; blends are capped at half the length of either adjacent scene. The outgoing final frame blends into the start of the incoming scene. Scene durations stay intact, preserving narration, captions, and sound-effect timing.

Use **Preview scene** to seek to a scene, then press play. **Video settings** sets defaults for newly added cameras and the project's transitions. Existing scenes retain their camera values until you edit them.

### Automation and review controls

- **Build My Draft** combines frame-aligned first-cut pacing, optional metadata-based panel matching, beat camera presets, optional locally synthesized sound suggestions, and optional English caption recognition. It returns a proposed edit without changing the project. Preview, accept selected shot suggestions, or discard. Global proposed timing applies even when individual shot suggestions are unchecked. Locked shots preserve their duration, camera, panel, captions, and effect settings; the remaining time is allocated across existing unlocked shots.
- Matching uses your saved storyboard assignments first, then word overlap with character, fight, title, and series tags. Unmatched lines fall back to story order. Hits/reveals/reactions use a small local keyword vocabulary. **This does not recognize comic artwork, verify events, or reliably identify punchlines.** Suggested excerpts rank action words and sentence boundaries in captions/script; timing-only candidates are shown when text is missing. Review the hook, payoff, framing, and ending yourself. No paid API is needed and these tools make no external requests.
- The geometric **Framing checks** flag large crops and potential readability concerns. They do not detect faces, speech balloons, or important objects. Click the original image under **Aim camera** to choose a target, or use **Read Panel** to display the entire panel with borders. The camera catalog includes a decaying impact shake. Safe-area guides are approximate and never appear in exports.
- **Sound favorites** include three original effects generated locally on first launch (impact, whoosh, reaction), plus uploaded favorites. Choose default impact/whoosh/reaction sounds under **Add your own sound favorites** for automatic placement. Each scene supports one effect with a configurable offset from its start; effects are trimmed to the shot’s end. Browser stage playback uses narration; use a rendered review copy or section to hear the complete mixed soundtrack.
- **Clean narration** previews steady-noise reduction and optional trims of pauses longer than 0.6 seconds, retaining about 0.24 seconds of each long pause. Acceptance changes the narration asset and maps scene boundaries, captions, storyboard times, notes, and sound offsets to the new recording. Undo restores the original. If trimming would alter a locked shot, unlock it or use noise reduction only. An audio preview becomes stale after another project edit and must be generated again. Keep up to 40 named versions; only five recent audio preview records are retained. Media referenced by history remains on disk.
- **Watched folder:** enable it under **Add files → Import automatically from a Windows folder**, copy the displayed path, and paste it into File Explorer. It is always `.data/inbox/<project-id>` on the **computer running Studio**, including Windows. No arbitrary filesystem path is accepted. While Studio runs, files unchanged across two three-second passes are imported once per content hash. Images/PDF/CBZ become project panels; `music-`/`bgm-` audio becomes music, `sfx-`/`effect-`/`impact-`/`whoosh-` audio becomes a favorite, other supported audio replaces narration, and SRT becomes captions. Files remain in the folder. Rename partial downloads only after copying completes; failed files show an error and corrected contents are retried. Imports increment the revision, so reload them explicitly with **Load imported files into editor**; an unsaved editor cannot silently overwrite the imported version. Do not use both a drop-zone upload and inbox import for the same file.
- **Recovery and reuse:** reconnect missing original panels/audio through **Recover missing files**; panel dimensions and narration/music duration must match. For a different asset, use Replace. Duplicate episodes get independent scene IDs and require approval again. Versions preserve asset references; deleting a version never deletes files needed by another revision. The browser remembers the last project, workflow step, and paused preview position.
- **Section previews** render only intersecting shots, retain their original camera phase, and offset narration/captions/effects. Final exports always cover the full selected project timeline. Batch exports validate projects individually and report ones that cannot be queued instead of silently skipping them.

## Publishing Desk: Facebook, Instagram, TikTok, and YouTube

The **Publishing** page can upload your approved **1080 × 1920 final MP4** to Cloudinary and hand a single video to multiple Buffer channels for scheduled posting. Each target gets its own Buffer post ID and result. You choose which channels to post to, supply a caption and YouTube title, and explicitly approve the public video upload. Studio will not automatically post every newly rendered video.

### One-time account setup

1. Create a [Buffer account](https://publish.buffer.com/) and connect your **Facebook Page**, **Instagram professional account**, **TikTok**, and **YouTube** in Buffer's own connection flow. Studio never needs those platforms' passwords. **Buffer Free currently supports only three channels**; connecting all four requires a qualifying paid Buffer subscription.
2. In Buffer Settings → API, create a personal API key.
3. Create a [Cloudinary account](https://cloudinary.com/), get its cloud name, API key, and API secret.
4. Start Studio and open **Publishing → Set up or update publishing credentials**. Save Buffer and Cloudinary credentials there. The Studio server stores the secrets only in its private local `.data/.publisher-connection.json`, never in GitHub, database responses, or JavaScript bundles. Do not share your Studio data directory or token.
5. Click **Refresh** to load the social channels linked to Buffer.

### Upload a finished video

1. Export an approved **final** video and open the **Publishing** tab.
2. Pick the finished video and the channels. Enter a caption for all channels and a separate YouTube title. Review all wording for platform suitability.
3. Keep **Save drafts in Buffer** selected for a safe first test. Check the public-hosting approval box and choose **Create Buffer drafts**.
4. After confirming everything works, choose **Add to Buffer publishing queue**. This requests automatic publishing at times configured on each Buffer channel. Posts may require extra per-platform confirmation; review each result in Buffer.
5. The **Publishing history** records accepted post IDs, errors, and uncertain submissions. Do not retry a request with an uncertain outcome until you check Buffer, otherwise duplicate posts may result.

The video is sent to **public Cloudinary hosting** because Buffer requires a stable public HTTPS URL. A video available on Cloudinary is technically accessible to anyone with the link, even if the Buffer post is only a draft. Do not use media you lack permission to upload or distribute. The public URL must remain reachable through the eventual publication date. The first integration supports uploads under 95 MiB; larger MP4s need a later resumable/chunked uploader. Publishing integrations are independent of your local project files and do not bypass copyrighted-source restrictions.

**Scope:** This is *one-click review and multi-channel submission*, not unattended end-to-end social posting. You must link accounts, review the final render and caption, and approve each submission. Buffer's actual publication schedule and social-network acceptance remain external. Live connections and real-world posts require your own account configuration; automated tests mock both providers.

## Configuration and privacy

Copy `.env.example` to `.env` only if you want overrides. The backend loads it from the repository root. Existing process variables take precedence. Both `.env` and `.data/` are ignored by Git.

| Variable | Purpose |
| --- | --- |
| `CB_DATA_DIR` | SQLite and asset directory; defaults to the repository’s `.data/`. Use an absolute path for external storage. |
| `CB_STUDIO_TOKEN` | Optional shared studio access token, at least 16 characters. Otherwise generated on disk. |
| `CB_COOKIE_SECURE` | Set `true` when serving through HTTPS. Default `false` supports local HTTP development. |
| `CB_FFMPEG`, `CB_FFPROBE` | Optional executable paths. Defaults to binaries on `PATH`. |
| `CB_AI_BASE_URL` | Optional HTTPS OpenAI-compatible base URL, usually ending in `/v1`. |
| `CB_AI_MODEL`, `CB_AI_API_KEY` | Optional writing model and credential. Never exposed to the frontend or stored in SQLite. |

The application binds to loopback by default. All API data, source media, downloads, and API docs require authentication. Sign-in issues a 24-hour HttpOnly, SameSite=Strict session cookie; API clients can use `Authorization: Bearer <studio-token>`. Cross-origin writes are rejected. No sources are fetched from the Internet during normal production. Source filenames and metadata are private application data.

For access beyond your local machine, place the studio behind a private HTTPS reverse proxy or VPN, set `CB_COOKIE_SECURE=true`, and restrict access to the operator. This MVP has one shared operator token, not per-user accounts or tenant isolation. Do not expose the Vite development server publicly. If the writing provider is enabled, the operator’s idea, saved script, and panel metadata are sent to that provider; panel image files are not sent.

Import limits: 20 files and 64 MB per batch, 100 resulting pages, 32 megapixels per image, maximum 4096-pixel normalized image edge, and maximum 256 MB expanded CBZ size. ZIP traversal, encryption, and excessive compression are rejected. Password-protected PDFs are unsupported. Whole requests are capped at 65 MB including multipart overhead. Narration is capped at 180 seconds; individual sound effects at 30 seconds. Upload only material you are entitled to use. The application does not bypass DRM, paywalls, or access restrictions.

## Architecture

```text
frontend/                 React + TypeScript + Vite production UI
  src/Editor.tsx          Scene sequencing, script review, narration, settings
  src/Preview.tsx         Browser motion/narration preview
  e2e/                    Chromium import-to-export and mobile tests
backend/app/
  api.py                  Validated project, panel, template, and render API
  database.py             SQLAlchemy models / SQLite WAL persistence
  importer.py             Pillow images, PDFium PDF pages, safe CBZ reading
  renderer.py             Bounded FFmpeg worker, snapshots, captions, audio mix
  audio.py                Offline English captions, script alignment, waveform/SRT tools
  autoedit.py             Pace-specific first cuts and explicit narration excerpts
  workspace.py            Atomic autosave, revision conflicts, durable undo/redo
  automation.py           Explainable matching, beats, shorts, section slicing, original effects
  production.py           Guided workflow, versions, file recovery, audio cleanup, export queue
  director.py             Durable opt-in Verdict upload-to-video jobs and approval
  verdict_provider.py     Optional vision/speech APIs and private GUI connection
  inbox.py                Opt-in local project folder importer
  effects.py              Camera paths, easing, and frame-aligned transition limits
  storage.py              Storage protocol + confined local filesystem adapter
  integrations.py         Writing, authorized source, and voice extension points
  auth.py, limits.py      Private sessions and streamed request limits
backend/tests/            Generated-original fixtures and media integration tests
scripts/setup.sh          Repeatable installation and frontend build
```

SQLite records projects, scene order, scripts and approval, panel provenance, templates, and render jobs. Assets use opaque relative storage keys so an object-storage adapter can be introduced without embedding filesystem paths into project data. The current renderer needs local files; a future cloud adapter must stage objects for FFmpeg and provide authenticated delivery.

Rendering uses a single background thread, a bounded queue (20 active jobs, one per project), and at most two FFmpeg encoder threads. Scenes are frame-quantized, rendered to identical H.264 segments, concatenated, optionally subtitled, then mixed with narration and scene audio. On restart, interrupted jobs are marked failed with a retry instruction; requeue them manually with **Render MP4**. Run **one Uvicorn worker**. Multi-host queues, persistent worker processes, retries, cancellation, and progress inside an individual FFmpeg invocation are future work.

For backups, stop the server and copy the whole data directory, including the database and assets. Back up configuration separately and protect the token file. Old audio, crops, logos, music, and exports are deliberately retained so queued snapshots, templates, and undo history remain valid; there is no automatic storage cleanup. Database tables are initialized automatically. Idempotent, additive upgrades add scene controls, project history/captions/assets, and template asset references without replacing existing records; a general versioned migration system remains future work.

### Optional modules

- **AI writing:** a working OpenAI-compatible HTTPS adapter, enabled only with the three `CB_AI_*` values. Drafts are returned to the editor without saving or approving them. Your cloud network policy must allow your chosen provider hostname. AI writing is not required for the core app.
- **Authorized comic databases / image sources:** protocol interfaces only. Future providers must implement authorized search and asset retrieval, provenance, and usage permissions.
- **Text-to-speech:** provider interface only; upload narration in the MVP.
- **Advanced agents, automated research, social publishing, and analytics:** deferred modules. No posting or account connection occurs.

Authenticated API documentation is available at `/api/docs`. Representative routes include `/api/panels/import`, `/api/panels/{id}/crop`, `/api/projects/{id}/scenes`, `/api/projects/{id}/narration`, `/api/projects/{id}/renders`, and `/api/renders/{id}/download`.

## Validation

```bash
make check                 # Ruff, backend tests (including a real FFmpeg render), frontend tests, build
npm --prefix frontend exec -- playwright install chromium
make e2e                   # Real browser workflow; owns ports 8000 and 5173

# To use an existing compatible Chromium binary:
CB_BROWSER_PATH=/usr/bin/chromium make e2e
```

The backend suite checks authentication, cookie/CSRF behavior, image/PDF/CBZ import, crop dimensions/provenance, unsafe archives and storage paths, atomic failed imports, scene ordering, approval gates, templates, audio validation, interrupted-job recovery, immutable render snapshots, and upgrades of existing scene records. Media tests render all 21 camera moves and all 12 transitions, verify transition boundary pixels and exact scene duration, and export a short 1080 × 1920 MP4 with captions, narration, and a sound effect. They inspect H.264/AAC dimensions and duration with FFprobe and decode the completed export. If FFmpeg is missing, media tests are explicitly skipped; CI installs it so they run.

Browser tests use programmatically generated original images and silence, exercise the import/crop/project/timeline/script/narration/export/download workflow, save and reload camera/transition choices, and check mobile camera controls for horizontal overflow. Unit tests check timeline operations, camera geometry, transition limits, and API/form behavior. Test data lives in temporary directories; no copyrighted comic assets are included.

Workflow tests additionally verify autosave conflicts and in-flight edits, crash-draft recovery, durable undo/redo and asset restoration, non-destructive upgrades of older projects/templates, independent pace/excerpt choices, silent-audio handling, caption import/edit/export, logo/music template reuse, 360p and 1080p exports with narration trims and timed captions, and measurable music attenuation during speech. Browser coverage exercises the complete new workflow and mobile layout. Windows CI installs the bundled recognizer and runs the workflow/media suite. Optional **Use script wording** aligns the saved script against audio when it exactly matches the recording and all spoken words are in the offline dictionary; unknown words produce an actionable error. Script alignment was also checked locally against original synthesized speech. Caption accuracy on a user's recordings and long-video production performance still need operator review.

GitHub Actions runs installation, checks, production build, and Chromium tests. The workflow itself requires a push to GitHub to execute. Actual paid writing services, TTS, external comic databases, social publishing, automatic winget prerequisite installation on a clean Windows PC, macOS, and fresh-cloud-snapshot restoration have not been verified. Functional export validation uses short clips; 65–90-second production performance and visual quality should be reviewed with your own authorized material.

The guided workflow is additionally tested with original generated panels/audio: mixed-file imports, suggested matches and accepted drafts, locked scene preservation, uploaded/favorite sound reuse, named versions and duplication, noise/pause previews with caption retiming, stable-file inbox deduplication, missing-file reconnection, batch queue validation, and real 360p section rendering. Browser coverage checks the five-step interface, storyboard, scene locks and Read Panel framing, guides/loop controls, notes, named versions, section download names, and mobile overflow. Semantic match quality, comic-name recognition, noise reduction on real microphones, long-video speed, and platform overlay placement remain operator-reviewed.
