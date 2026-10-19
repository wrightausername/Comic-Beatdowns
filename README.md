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

1. Open **Panel library → Import panels**. Choose images, PDF pages, or a CBZ. Add series, issue, starting page, characters, and fight notes. Images are normalized and saved locally; PDFs/CBZs produce one library item per page, in natural filename order for CBZs.
2. Open a panel to edit metadata or drag a crop rectangle. Optionally choose an output width. **Save as new panel** preserves the full source page and records the parent panel.
3. Create a project with an idea and template. **Add panels** in selection order. Drag scene handles to reorder, or use the accessible up/down buttons. Set durations, camera motion, incoming transitions, and optional captions. Try **Subtle push** or open **Camera strength, easing & framing** for more control. **Save timeline**.
4. In **Verdict script**, write panel-specific jokes and fight commentary. Aim for **175–220 spoken words / roughly 65–90 seconds**. Use the ending to set up the opening hook. Save the draft, review it, then **Approve script**. Script, scene, and video-setting changes require review again.
5. Upload narration. Supported FFmpeg-readable audio includes WAV, MP3, M4A, OGG, FLAC, AAC, and WebM. Uploaded audio is normalized to stereo 48 kHz WAV. Optionally attach a sound effect to each saved scene. Sound effects start at their scene, are trimmed to scene length, and mix at 35% volume.
6. Preview the sequence and narration. Save all changes, then **Render MP4**. If narration exceeds the timeline, extend scene durations; speech is never silently truncated. Short narration is padded with silence.
7. Open **Exports** to review the actual video on repeat and download it. A render captures a fixed revision, so later edits cannot change a queued export. Previous exports remain available.

The duration target is advisory; short clips and videos up to 180 seconds are allowed. The in-browser preview approximates motion, transitions, timed captions, logo placement, and the selected narration range. Review the actual MP4 for final caption appearance and the audio mix. A looping script ending is supported by the writing workflow and repeat playback; automatic crossfading from the final scene back to the first is not implemented.

### Make editing effortless

1. **Auto Edit:** add panels and narration, choose **Fast · punchy** or **Slow · smooth**, then **Create first cut**. Fast defaults to roughly 1.25-second shots with punch-ins, reframing, mostly hard cuts, and occasional short slides. Slow defaults to roughly five-second shots with smoother moves and crossfades. Adjust average shot length before generating. Panels stay in story order, and repeated shots of each panel stay together. Auto Edit uses nearby narration pauses for cut placement; it does not identify faces, impacts, or semantic links between speech and panels. Review close-ups and scene choices.
2. **Independent length choice:** either pace can use **Full narration** or **Short · first 30 seconds or less**. Short deliberately selects an excerpt, ending near a pause within the last two seconds where available. The selected in/out points are shown in **Narration track** and can be adjusted or reset with **Use full narration**. Preview, captions, and export respect the selection. Unselected narration is preserved on disk.
3. **Autosave and undo:** title, idea, script, timeline, settings, and timed captions save together after about 0.9 seconds without an edit. **All changes saved** confirms a database save. Invalid values and connection errors show a failure banner. Unsaved browser drafts can be recovered after reopening a project. **Undo/Redo** stores up to 50 states in SQLite, including scene sound-effect associations and project assets. Ctrl+S saves; Ctrl+Z / Ctrl+Shift+Z work outside text inputs. Native text undo stays available while typing. Concurrent edits from another window produce a conflict instead of overwriting that window's changes.
4. **Bulk editing and timing:** select scenes or **Select all**, choose motion, transition, duration, or strength, then **Apply to selected**. **Fit narration** distributes the selected recording across the current scenes. Click the narration waveform to seek; drag a cut handle to adjust its two neighboring scenes without changing total duration. Focus a cut and use arrow keys for one-frame adjustments, or Shift+Arrow for five frames.
5. **Automatic captions:** **Generate captions** runs a bundled, offline English PocketSphinx recognizer. No account, GPU, API key, or separate model download is required. It produces short timed phrases for review. This lightweight recognizer can mishear names, accents, noisy recordings, and comic terminology; correct text and timing before production. Import an existing UTF-8 SRT for more accurate externally prepared captions, edit cues, and download the saved SRT. Cue times refer to the original narration and are shifted automatically for excerpts. Timed cues take priority over scene captions. Punchy styling emphasizes the last word of each phrase.
6. **Voice-led audio:** enable narration loudness normalization and choose narration, music, and sound-effect levels in **Settings**. Upload background music; it loops to the timeline length. Automatic ducking lowers music and effects during speech, and a final limiter controls peaks. These settings are applied in exported previews and final MP4s; the browser's audio players play the original tracks.
7. **Fast draft exports:** **Draft preview** renders at **360 × 640** using smaller intermediate frames. It works before script approval. Final **Render MP4** remains **1080 × 1920** and requires approval after changes. Drafts and final exports are labeled in history and filenames. All exports capture a fixed saved revision.
8. **Reusable brand kits:** templates now preserve editing pace, camera defaults, transition settings, caption style/size/colors/position, logo placement/size, the logo image, music track, and audio levels. New projects reuse the assets and reset narration in/out points. Upload assets you are authorized to use.

### Camera and transition controls

- **20 camera options:** hold, push in, pull back, four directional pans, four diagonal drifts, four moving pushes, two moving pulls, quick punch in/out, and a gentle breathing zoom.
- **12 transitions:** hard cut, crossfade, dips to black/white, four directional slides, two soft slides, and two wipes. Each scene can inherit the project default or override it.
- **Adjustable motion:** 2–30% movement strength, four easing curves, and horizontal/vertical framing. Start with 6–12% strength and smooth easing for restrained motion. Framing selects the part of a wide/tall panel retained by the vertical crop.
- **Short blends:** choose 0.08–0.8 seconds; blends are capped at half the length of either adjacent scene. The outgoing final frame blends into the start of the incoming scene. Scene durations stay intact, preserving narration, captions, and sound-effect timing.

Use **Preview scene** to seek to a scene, then press play. **Video settings** sets defaults for newly added cameras and the project's transitions. Existing scenes retain their camera values until you edit them.

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
  effects.py              Camera paths, easing, and frame-aligned transition limits
  storage.py              Storage protocol + confined local filesystem adapter
  integrations.py         Writing, authorized source, and voice extension points
  auth.py, limits.py      Private sessions and streamed request limits
backend/tests/            Generated-original fixtures and media integration tests
scripts/setup.sh          Repeatable installation and frontend build
```

SQLite records projects, scene order, scripts and approval, panel provenance, templates, and render jobs. Assets use opaque relative storage keys so an object-storage adapter can be introduced without embedding filesystem paths into project data. The current renderer needs local files; a future cloud adapter must stage objects for FFmpeg and provide authenticated delivery.

Rendering uses a single background thread, a bounded queue (five active jobs), and at most two FFmpeg encoder threads. Scenes are frame-quantized, rendered to identical H.264 segments, concatenated, optionally subtitled, then mixed with narration and scene audio. On restart, interrupted jobs are marked failed with a retry instruction; requeue them manually with **Render MP4**. Run **one Uvicorn worker**. Multi-host queues, persistent worker processes, retries, cancellation, and progress inside an individual FFmpeg invocation are future work.

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

The backend suite checks authentication, cookie/CSRF behavior, image/PDF/CBZ import, crop dimensions/provenance, unsafe archives and storage paths, atomic failed imports, scene ordering, approval gates, templates, audio validation, interrupted-job recovery, immutable render snapshots, and upgrades of existing scene records. Media tests render all 20 camera moves and all 12 transitions, verify transition boundary pixels and exact scene duration, and export a short 1080 × 1920 MP4 with captions, narration, and a sound effect. They inspect H.264/AAC dimensions and duration with FFprobe and decode the completed export. If FFmpeg is missing, media tests are explicitly skipped; CI installs it so they run.

Browser tests use programmatically generated original images and silence, exercise the import/crop/project/timeline/script/narration/export/download workflow, save and reload camera/transition choices, and check mobile camera controls for horizontal overflow. Unit tests check timeline operations, camera geometry, transition limits, and API/form behavior. Test data lives in temporary directories; no copyrighted comic assets are included.

Workflow tests additionally verify autosave conflicts and in-flight edits, crash-draft recovery, durable undo/redo and asset restoration, non-destructive upgrades of older projects/templates, independent pace/excerpt choices, silent-audio handling, caption import/edit/export, logo/music template reuse, 360p and 1080p exports with narration trims and timed captions, and measurable music attenuation during speech. Browser coverage exercises the complete new workflow and mobile layout. Windows CI installs the bundled recognizer and runs the workflow/media suite. Optional **Use script wording** aligns the saved script against audio when it exactly matches the recording and all spoken words are in the offline dictionary; unknown words produce an actionable error. Script alignment was also checked locally against original synthesized speech. Caption accuracy on a user's recordings and long-video production performance still need operator review.

GitHub Actions runs installation, checks, production build, and Chromium tests. The workflow itself requires a push to GitHub to execute. Actual paid writing services, TTS, external comic databases, social publishing, automatic winget prerequisite installation on a clean Windows PC, macOS, and fresh-cloud-snapshot restoration have not been verified. Functional export validation uses short clips; 65–90-second production performance and visual quality should be reviewed with your own authorized material.
