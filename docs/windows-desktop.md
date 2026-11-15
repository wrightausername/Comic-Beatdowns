# Comic Beatdowns Studio: Windows desktop packaging

This is an **implementation track**, not a declaration that the application is
finished. The current React UI, FastAPI API and FFmpeg renderer remain the source
of truth. The desktop shell embeds that same application in a native Windows
WebView2 window, with no browser tab or console window required.

## Building and downloading

1. Open the **Package Windows desktop EXE** workflow on GitHub Actions.
2. Run the workflow manually, or open a pull request that changes relevant code.
3. After the Windows job **passes**, download its
   `Comic-Beatdowns-Studio-Windows` artifact.
4. Extract `Comic-Beatdowns-Studio-Windows.zip` to a normal folder.
5. Double-click **Comic Beatdowns Studio.exe** inside that folder.

This update uses a PyInstaller **single-executable** bundle. Download the
`Comic-Beatdowns-Studio-Windows` artifact ZIP, choose **Extract All**, then launch
**Comic Beatdowns Studio.exe**. There is no second ZIP or external `_internal`
folder to move. Python and media tools unpack into a temporary runtime folder
when launched; Python, Node and FFmpeg do not need to be installed separately.
Windows WebView2 Runtime and a compatible .NET runtime remain prerequisites.

Windows 10 and Windows 11 are both intended desktop targets. CI verifies the
actual downloaded executable on separate Windows Server 2022 and 2025 runners,
with developer tools removed from PATH, checking both backend startup and the
native WebView2 window with authenticated React UI. Those server checks do not
establish clean Windows 10/11 desktop compatibility; actual desktop testing
is still required before calling both fully supported. No automatic runtime
installer or signed installer is included yet.

## Behavior and privacy

- The server binds to **127.0.0.1** and an ephemeral port, not your network.
- The native window receives a one-use random login link and an HttpOnly
  session cookie. The login ticket is not written to a log or shared with
  other applications. Existing API authentication is unchanged.
- Projects, media, outputs, the private token and connected AI credentials
  persist under `%LOCALAPPDATA%\ComicBeatdownsStudio`. Upgrading/replacing the
  application folder does not delete them.
- To migrate projects from the old `Start Studio.cmd` checkout, close the
  older studio, back up its `.data` folder, and copy its **contents** into
  `%LOCALAPPDATA%\ComicBeatdownsStudio` before starting the .exe. Avoid
  overwriting a newly created project library.
- Downloads inside the embedded window are enabled. External links intended
  for new tabs open in the system browser.
- Logs on launch failure are written to
  `%LOCALAPPDATA%\ComicBeatdownsStudio\desktop-error.log`.

## Local Windows build (developers)

Build the React frontend, then install app dependencies and packaging tools:

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
py -3.12 -m pip install -r backend/requirements.lock
py -3.12 -m pip install --no-deps -e backend
py -3.12 -m pip install "pyinstaller>=6.10,<7" "pywebview>=5.4,<7"
choco install ffmpeg -y
py -3.12 scripts/build_desktop.py
& ".\desktop-dist\Comic Beatdowns Studio.exe" --check
& ".\desktop-dist\Comic Beatdowns Studio.exe" --ui-check
```

Before distributing beyond the project owner, audit the licenses and source
distribution requirements for every bundled library and the selected FFmpeg
build. Sign the executable or installer before public release. An MSI/Inno Setup
installer, code-signing, updates and graphical end-to-end testing are separate
release-hardening tasks.

## AI production roadmap: build on the existing PR, do not duplicate

The open one-click episode PR implements early intake/staging. Extend it after
merge with these milestones:

1. **Idea-first episode intake:** drag in panel/page images, source PDFs,
   script text, narration, music and effects in one drop zone, or paste an idea.
2. **Evidence-led panel understanding:** segment pages into panels, OCR where
   appropriate, classify characters/actions and match script beats to the
   visible content; never invent source details. User confirms questionable
   crops and matches.
3. **Verdict script + delivery:** produce a commentary script with an
   adjustable craziness/edge level, natural non-repetitive jokes, controlled
   nicknames, reference checking and a hook/loop designed for Shorts.
   Generate narration externally in ElevenLabs and import the MP3/WAV; internal voice generation is outside the current scope.
4. **Auto-Director:** narration-first timing, precise speaker/beat alignment,
   shot selection, intelligent crops, subtle camera moves, dynamic captions,
   audio ducking, reaction effects, transitions and preview renders.
5. **Review, repair and export:** mark a scene `Keep`, `Fix crop`,
   `Replace panel`, `Change line` or `Rebuild`; preserve locked choices,
   redo only changed shots, and export a polished 1080 x 1920 MP4 of roughly
   65-90 seconds by default.
6. **CapCut handoff:** an optional workflow, not a prerequisite. Start with
   reliably organized media/captions/timing assets; do not promise a native
   editable CapCut project until its import requirements have been validated.

### Completion criteria

An owner can install, drag in an idea plus a panel folder, generate a proposed
episode, approve or repair scenes, listen to Verdict, and export a complete MP4
without command-line tools. The app must clearly distinguish AI suggestions from
verified source material, save intermediate work, and recover after interrupted
renders. Do not claim this is achieved until actual Windows testing proves it.

Comic artwork rights and platform commentary/fair-use considerations remain
the creator's responsibility; the app should not scrape unauthorized scans or
misrepresent fair use as a guarantee.
