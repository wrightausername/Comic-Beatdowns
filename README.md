# Comic Beatdowns Studio

A private, browser-based production desk for **Comic Beatdowns**, hosted by **Verdict**. Import authorized comic sources, catalog and crop panels, write a sharp commentary script, arrange a vertical timeline, upload narration, and render a downloadable **1080 × 1920 MP4** with FFmpeg. No paid API credentials are required.

## Quick start

Requirements: **Python 3.11+** (tested on 3.12), **Node 22+**, npm, and **FFmpeg + FFprobe** with the `libx264` encoder and `subtitles`/libass filter. Linux is the validated platform.

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
3. Create a project with an idea and template. **Add panels** in selection order. Drag scene handles to reorder, or use the accessible up/down buttons. Set durations, hold/zoom/pan motion, and optional captions. **Save timeline**.
4. In **Verdict script**, write panel-specific jokes and fight commentary. Aim for **175–220 spoken words / roughly 65–90 seconds**. Use the ending to set up the opening hook. Save the draft, review it, then **Approve script**. Script, scene, and video-setting changes require review again.
5. Upload narration. Supported FFmpeg-readable audio includes WAV, MP3, M4A, OGG, FLAC, AAC, and WebM. Uploaded audio is normalized to stereo 48 kHz WAV. Optionally attach a sound effect to each saved scene. Sound effects start at their scene, are trimmed to scene length, and mix at 35% volume.
6. Preview the sequence and narration. Save all changes, then **Render MP4**. If narration exceeds the timeline, extend scene durations; speech is never silently truncated. Short narration is padded with silence.
7. Open **Exports** to review the actual video on repeat and download it. A render captures a fixed revision, so later edits cannot change a queued export. Previous exports remain available.

The duration target is advisory; short test clips and videos up to 180 seconds are allowed. Captions are manually authored **per scene**, not automatic transcription or word-level subtitles. The in-browser preview approximates motion and plays narration; the MP4 is the authoritative preview for caption layout, fades, sound effects, and the mix. Transitions are hard cuts or short dips to black. A looping script ending is supported by the writing workflow and repeat playback; automatic seamless visual crossfades are not implemented.

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
  storage.py              Storage protocol + confined local filesystem adapter
  integrations.py         Writing, authorized source, and voice extension points
  auth.py, limits.py      Private sessions and streamed request limits
backend/tests/            Generated-original fixtures and media integration tests
scripts/setup.sh          Repeatable installation and frontend build
```

SQLite records projects, scene order, scripts and approval, panel provenance, templates, and render jobs. Assets use opaque relative storage keys so an object-storage adapter can be introduced without embedding filesystem paths into project data. The current renderer needs local files; a future cloud adapter must stage objects for FFmpeg and provide authenticated delivery.

Rendering uses a single background thread, a bounded queue (five active jobs), and at most two FFmpeg encoder threads. Scenes are frame-quantized, rendered to identical H.264 segments, concatenated, optionally subtitled, then mixed with narration and scene audio. On restart, interrupted jobs are marked failed with a retry instruction; requeue them manually with **Render MP4**. Run **one Uvicorn worker**. Multi-host queues, persistent worker processes, retries, cancellation, and progress inside an individual FFmpeg invocation are future work.

For backups, stop the server and copy the whole data directory, including the database and assets. Back up configuration separately and protect the token file. Old audio, crops, and exports are deliberately retained so queued snapshots remain valid; there is no automatic storage cleanup or UI deletion yet. Database tables are initialized automatically; versioned migrations will be needed for future schema changes.

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

The backend suite checks authentication, cookie/CSRF behavior, image/PDF/CBZ import, crop dimensions/provenance, unsafe archives and storage paths, atomic failed imports, scene ordering, approval gates, templates, audio validation, interrupted-job recovery, and immutable render snapshots. Its real FFmpeg test exports a short 1080 × 1920 MP4 with captions, fades, narration, and a sound effect, inspects H.264/AAC dimensions and duration with FFprobe, and decodes every frame. If FFmpeg is missing that test is explicitly skipped; CI installs it so the render test runs.

Browser tests use programmatically generated original images and silence, exercise the import/crop/project/timeline/script/narration/export/download workflow, and check mobile navigation for horizontal overflow. Unit tests check timeline operations and API/form behavior. Test data lives in temporary directories; no copyrighted comic assets are included.

GitHub Actions runs installation, checks, production build, and Chromium tests. The workflow itself requires a push to GitHub to execute. Actual paid writing services, TTS, external comic databases, social publishing, Windows/macOS, and fresh-cloud-snapshot restoration have not been verified. Functional export validation uses short clips; 65–90-second production performance and visual quality should be reviewed with your own authorized material.
