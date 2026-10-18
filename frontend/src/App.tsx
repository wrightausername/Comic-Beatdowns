import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  Grid2X2,
  Layers,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { api, json } from "./api";
import {
  Brand,
  Checklist,
  Empty,
  Modal,
  StatusPill,
  Verdict,
} from "./components";
import { ImportPanels, NewProject, PanelDetail } from "./dialogs";
import Editor from "./Editor";
import type {
  Integrations,
  Panel,
  Project,
  RenderJob,
  Status,
  Template,
} from "./types";
import { errorMessage, timecode } from "./utils";

type Page = "production" | "library" | "exports" | "templates" | "connections";
const initialIntegrations: Integrations = {
  writing_enabled: false,
  voice_generation_enabled: false,
  publishing_enabled: false,
  comic_sources: [],
  storage: "local",
};

function SignIn({
  onSignedIn,
  onError,
}: {
  onSignedIn: () => void;
  onError: (message: string) => void;
}) {
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/login", json({ token }));
      onSignedIn();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sign-in">
      <div className="login-card">
        <Brand />
        <Verdict />
        <span className="eyebrow">YOUR PRIVATE PRODUCTION DESK</span>
        <h1>Welcome to the studio.</h1>
        <p>Bring the panels. Verdict brings the attitude.</p>
        <form onSubmit={submit}>
          <label>
            Studio access token
            <input
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your private access token"
            />
          </label>
          <button className="button" disabled={busy || !token}>
            <LockKeyhole size={16} />
            {busy ? "Signing in…" : "Enter the studio"}
          </button>
        </form>
        <p className="help">
          On first launch, your token is generated in{" "}
          <code>.data/.studio-token</code>. You can also set{" "}
          <code>CB_STUDIO_TOKEN</code> in your environment.
        </p>
        <span className="login-footer">
          <ShieldCheck size={14} />
          Private by default. Your sources stay yours.
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [page, setPage] = useState<Page>("production");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [panels, setPanels] = useState<Panel[]>([]);
  const [jobs, setJobs] = useState<RenderJob[]>([]),
    [templates, setTemplates] = useState<Template[]>([]);
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [preferredTemplate, setPreferredTemplate] = useState<
    string | undefined
  >(undefined);
  const [dialog, setDialog] = useState<"new" | "import" | "help" | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<Panel | null>(null);
  const [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<Status | "all">("all");
  const [loading, setLoading] = useState(true);
  const showError = useCallback((message: string) => setError(message), []);
  const refresh = useCallback(async () => {
    try {
      const [p, assets, renders, presets, connections] = await Promise.all([
        api<Project[]>("/projects"),
        api<Panel[]>("/panels"),
        api<RenderJob[]>("/renders"),
        api<Template[]>("/templates"),
        api<Integrations>("/integrations"),
      ]);
      setProjects(p);
      setPanels(assets);
      setJobs(renders);
      setTemplates(presets);
      setIntegrations(connections);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    api<{ authenticated: boolean }>("/auth/session")
      .then((s) => setAuthenticated(s.authenticated))
      .catch((e) => {
        setError(errorMessage(e));
        setAuthenticated(false);
      });
    const expired = () => setAuthenticated(false);
    window.addEventListener("studio:unauthorized", expired);
    return () => window.removeEventListener("studio:unauthorized", expired);
  }, []);
  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated, refresh]);
  useEffect(() => {
    if (
      !authenticated ||
      (page !== "exports" &&
        !jobs.some((j) => j.status === "queued" || j.status === "running"))
    )
      return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [authenticated, page, jobs, refresh]);
  function navigate(next: Page, id: string | null = null) {
    if (
      dirty &&
      !window.confirm("Leave this workspace and discard unsaved changes?")
    )
      return;
    setDirty(false);
    setPage(next);
    setSelectedId(id);
    setQuery("");
  }
  const navItems = [
    {
      id: "production" as const,
      icon: Clapperboard,
      title: "Production desk",
      count: projects.length,
    },
    {
      id: "library" as const,
      icon: BookOpen,
      title: "Panel library",
      count: panels.length,
    },
    {
      id: "exports" as const,
      icon: ArrowDownToLine,
      title: "Exports",
      count: jobs.filter((j) => j.status === "completed").length,
    },
  ];
  const filteredProjects = projects.filter(
    (p) =>
      (filter === "all" ||
        p.status === filter ||
        (filter === "scripting" &&
          ["ready", "rendering"].includes(p.status))) &&
      `${p.title} ${p.idea}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredPanels = panels.filter((p) =>
    `${p.title} ${p.series} ${p.issue} ${p.page ?? ""} ${p.characters} ${p.fight}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const toast = error && (
    <div className="error-toast" role="alert">
      <span>{error}</span>
      <button
        className="icon-button"
        aria-label="Dismiss error"
        onClick={() => setError("")}
      >
        <X size={17} />
      </button>
    </div>
  );
  if (authenticated === null)
    return (
      <div className="loading full">
        <LoaderCircle className="spin" />
        Connecting to the studio…
      </div>
    );
  if (!authenticated)
    return (
      <>
        <SignIn
          onSignedIn={() => {
            setAuthenticated(true);
            setError("");
          }}
          onError={showError}
        />
        {toast}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="workspace-label">
          <i />
          VERDICT’S WORKSPACE
        </span>
        <div className="nav-label">STUDIO</div>
        <nav>
          {navItems.map(({ id, icon: Icon, title, count }) => (
            <button
              key={id}
              aria-label={title}
              className={page === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{title}</span>
              <small>{count}</small>
            </button>
          ))}
        </nav>
        <div className="nav-label resources-label">WORKSPACE</div>
        <nav>
          <button
            aria-label="Video templates"
            className={page === "templates" ? "active" : ""}
            onClick={() => navigate("templates")}
          >
            <Layers size={18} />
            <span>Video templates</span>
          </button>
          <button
            aria-label="Connections"
            className={page === "connections" ? "active" : ""}
            onClick={() => navigate("connections")}
          >
            <Link2 size={18} />
            <span>Connections</span>
            <span className="nav-dot" />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-storage">
            <span className="storage-icon">
              <FolderOpen size={19} />
            </span>
            <div>
              <strong>Local workspace</strong>
              <small>Private sources & exports</small>
            </div>
            <ShieldCheck size={14} />
          </div>
          <button className="sidebar-help" onClick={() => setDialog("help")}>
            <CircleHelp size={16} />
            Studio guide
            <ChevronRight size={14} />
          </button>
          <button
            className="sidebar-help"
            onClick={() => {
              if (
                dirty &&
                !window.confirm("Sign out and discard unsaved changes?")
              )
                return;
              void api("/auth/logout", json({}))
                .then(() => setAuthenticated(false))
                .catch((e) => showError(errorMessage(e)));
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
          <div className="brand-footer">
            <Zap size={12} />
            COMIC BEATDOWNS <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            Studio<span>/</span>
            {selectedId
              ? "Project workspace"
              : (navItems.find((n) => n.id === page)?.title ??
                (page === "templates" ? "Video templates" : "Connections"))}
          </div>
          <div className="topbar-right">
            <span className="private-badge">
              <LockKeyhole size={12} />
              PRIVATE STUDIO
            </span>
            <span className="avatar">CB</span>
          </div>
        </header>
        <main>
          {selectedId ? (
            <Editor
              key={selectedId}
              projectId={selectedId}
              panels={panels}
              integrations={integrations}
              onBack={() => navigate("production")}
              onChanged={() => void refresh()}
              onError={showError}
              onDirty={setDirty}
              onImport={() => setDialog("import")}
            />
          ) : (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">COMIC BEATDOWNS STUDIO</span>
                  <h1>
                    {page === "production"
                      ? "The production desk."
                      : page === "library"
                        ? "Every panel. Every punch."
                        : page === "exports"
                          ? "Ready for the spotlight."
                          : page === "templates"
                            ? "Your signature. On repeat."
                            : "Build your production stack."}
                  </h1>
                  <p>
                    {page === "production"
                      ? "From the first panel to the final verdict. Make it hit."
                      : page === "library"
                        ? "Collect the evidence. Organize your sources. Find the perfect beat."
                        : page === "exports"
                          ? "Review your rendered videos and download the finished cut."
                          : page === "templates"
                            ? "Reusable motion, timing, and caption defaults for your next beatdown."
                            : "The core studio works locally. Add optional services when you need them."}
                  </p>
                </div>
                {page === "production" ? (
                  <button className="button" onClick={() => setDialog("new")}>
                    <Plus size={17} />
                    New project
                  </button>
                ) : page === "library" ? (
                  <button
                    className="button"
                    onClick={() => setDialog("import")}
                  >
                    <Upload size={17} />
                    Import panels
                  </button>
                ) : null}
              </div>
              {loading ? (
                <div className="loading">
                  <LoaderCircle className="spin" />
                  Opening your workspace…
                </div>
              ) : (
                <>
                  {page === "production" && (
                    <>
                      <div className="stats-grid">
                        <div className="stat-card">
                          <span className="stat-icon cyan">
                            <Clapperboard size={20} />
                          </span>
                          <div>
                            <span>Active productions</span>
                            <strong>
                              {projects
                                .filter((p) => p.status !== "exported")
                                .length.toString()
                                .padStart(2, "0")}
                            </strong>
                          </div>
                          <small>IN THE PIPELINE</small>
                        </div>
                        <div className="stat-card">
                          <span className="stat-icon purple">
                            <BookOpen size={20} />
                          </span>
                          <div>
                            <span>Panels in your library</span>
                            <strong>
                              {panels.length.toString().padStart(2, "0")}
                            </strong>
                          </div>
                          <small>THE EVIDENCE</small>
                        </div>
                        <div className="stat-card">
                          <span className="stat-icon green">
                            <Film size={20} />
                          </span>
                          <div>
                            <span>Completed exports</span>
                            <strong>
                              {jobs
                                .filter((j) => j.status === "completed")
                                .length.toString()
                                .padStart(2, "0")}
                            </strong>
                          </div>
                          <small>READY TO DROP</small>
                        </div>
                      </div>
                      <div className="production-layout">
                        <section className="projects-section">
                          <div className="section-heading">
                            <h2>
                              Your productions{" "}
                              <span className="count">{projects.length}</span>
                            </h2>
                            <span className="muted tiny">LATEST FIRST</span>
                          </div>
                          <div className="project-toolbar">
                            <div className="filter-tabs">
                              {(
                                [
                                  "all",
                                  "idea",
                                  "scripting",
                                  "exported",
                                ] as const
                              ).map((f) => (
                                <button
                                  key={f}
                                  className={filter === f ? "active" : ""}
                                  onClick={() => setFilter(f)}
                                >
                                  {f === "all"
                                    ? "All projects"
                                    : f === "idea"
                                      ? "Ideas"
                                      : f === "scripting"
                                        ? "In production"
                                        : "Exported"}
                                </button>
                              ))}
                            </div>
                            <div className="search-box">
                              <Search size={15} />
                              <input
                                aria-label="Search projects"
                                placeholder="Find a project…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                              />
                            </div>
                          </div>
                          {filteredProjects.length ? (
                            <div className="project-grid">
                              {filteredProjects.map((project) => (
                                <button
                                  className="project-card"
                                  key={project.id}
                                  onClick={() =>
                                    navigate("production", project.id)
                                  }
                                >
                                  <div className="project-cover">
                                    {project.cover_url ? (
                                      <img src={project.cover_url} alt="" />
                                    ) : (
                                      <>
                                        <div className="cover-lines" />
                                        <Clapperboard size={34} />
                                        <span>AWAITING THE EVIDENCE</span>
                                      </>
                                    )}
                                    <span className="cover-format">9:16</span>
                                    {project.scene_count > 0 && (
                                      <span className="cover-time">
                                        {timecode(project.duration)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="project-card-content">
                                    <StatusPill status={project.status} />
                                    <h3>{project.title}</h3>
                                    <p>
                                      {project.idea ||
                                        "Every fight needs an angle. Find yours."}
                                    </p>
                                    <div className="project-card-footer">
                                      <span>
                                        <Layers size={13} />
                                        {project.scene_count} scenes
                                      </span>
                                      <span>
                                        Open workspace
                                        <ArrowRight size={14} />
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="surface">
                              <Empty
                                title={
                                  projects.length
                                    ? "No projects match this view"
                                    : "Your next great beatdown starts here"
                                }
                                action={
                                  <button
                                    className="button secondary"
                                    onClick={() => setDialog("new")}
                                  >
                                    <Plus size={16} />
                                    Create a project
                                  </button>
                                }
                              >
                                {projects.length
                                  ? "Try another filter or project title."
                                  : "Choose a fight, collect your panels, and let Verdict deliver the commentary."}
                              </Empty>
                            </div>
                          )}
                          <div className="workflow-strip">
                            <span>THE WORKFLOW</span>
                            <div>
                              <b>01</b> Collect
                              <ChevronRight size={13} />
                              <b>02</b> Write
                              <ChevronRight size={13} />
                              <b>03</b> Sequence
                              <ChevronRight size={13} />
                              <b>04</b> Export
                            </div>
                          </div>
                        </section>
                        <aside className="production-rail">
                          <section className="verdict-card">
                            <div className="verdict-card-top">
                              <span className="eyebrow">MEET YOUR HOST</span>
                              <span className="online-dot">ONLINE</span>
                            </div>
                            <Verdict />
                            <div className="verdict-name">
                              VERDICT
                              <span>
                                HOLOGRAPHIC HOST / PROFESSIONAL INSTIGATOR
                              </span>
                            </div>
                            <blockquote>
                              “Bring me the panels.
                              <br />
                              I’ll bring the disrespect.”
                            </blockquote>
                            <p>
                              Your fight. Your evidence. One unforgettable
                              verdict.
                            </p>
                            <button
                              className="button secondary"
                              onClick={() => setDialog("new")}
                            >
                              <Sparkles size={15} />
                              Start a production
                              <ArrowRight size={14} />
                            </button>
                          </section>
                          <section className="surface quick-start">
                            <span className="eyebrow">YOUR FIRST BEATDOWN</span>
                            <Checklist
                              checks={[
                                [
                                  "Import your source panels",
                                  panels.length > 0,
                                ],
                                ["Create a production", projects.length > 0],
                                [
                                  "Approve a Verdict script",
                                  projects.some((p) => p.script_approved),
                                ],
                                [
                                  "Render your first MP4",
                                  jobs.some((j) => j.status === "completed"),
                                ],
                              ]}
                            />
                            <button
                              className="text-button"
                              onClick={() => setDialog("help")}
                            >
                              See the studio guide
                              <ArrowRight size={14} />
                            </button>
                          </section>
                        </aside>
                      </div>
                    </>
                  )}
                  {page === "library" && (
                    <>
                      <div className="library-toolbar">
                        <div className="search-box">
                          <Search size={17} />
                          <input
                            aria-label="Search panel library"
                            placeholder="Search title, series, issue, characters, or fight details…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        <span className="muted">
                          {filteredPanels.length} panels
                        </span>
                        <SlidersHorizontal size={17} className="muted" />
                      </div>
                      {filteredPanels.length ? (
                        <div className="panel-grid">
                          {filteredPanels.map((panel) => (
                            <button
                              className="panel-card"
                              key={panel.id}
                              onClick={() => setSelectedPanel(panel)}
                            >
                              <div>
                                <img
                                  src={panel.thumbnail_url}
                                  alt={panel.title}
                                  loading="lazy"
                                />
                                <span>
                                  {panel.width} × {panel.height}
                                </span>
                                {panel.parent_id && <i>CROP</i>}
                              </div>
                              <section>
                                <span className="eyebrow">
                                  {panel.series || "UNSORTED SOURCE"}
                                  {panel.issue && ` · #${panel.issue}`}
                                </span>
                                <h3>{panel.title}</h3>
                                <p>
                                  {panel.characters ||
                                    "Add characters & fight details"}
                                  {panel.page && ` · p.${panel.page}`}
                                </p>
                              </section>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="surface">
                          <Empty
                            title={
                              query
                                ? "No matching evidence"
                                : "Build your panel library"
                            }
                            action={
                              <button
                                className="button secondary"
                                onClick={() => setDialog("import")}
                              >
                                <Upload size={16} />
                                Import source files
                              </button>
                            }
                          >
                            {query
                              ? "Try searching another series, character, or fight."
                              : "Import images, PDF pages, or CBZ files. Crop and catalog individual panels without changing your source pages."}
                          </Empty>
                        </div>
                      )}
                    </>
                  )}
                  {page === "exports" &&
                    (jobs.length ? (
                      <div className="exports-grid">
                        {jobs.map((job) => (
                          <section className="surface export-card" key={job.id}>
                            {job.video_url ? (
                              <video
                                src={job.video_url}
                                controls
                                loop
                                preload="metadata"
                                aria-label={`Export ${job.title}`}
                              />
                            ) : (
                              <div className="export-placeholder">
                                <Film size={32} />
                                <span>
                                  {job.status === "failed"
                                    ? "Render needs attention"
                                    : `Rendering · ${job.progress}%`}
                                </span>
                                {job.status !== "failed" && (
                                  <progress value={job.progress} max={100} />
                                )}
                              </div>
                            )}
                            <div>
                              <span
                                className={`mini-tag ${job.status === "completed" ? "approved" : ""}`}
                              >
                                {job.status.toUpperCase()}
                              </span>
                              <h3>{job.title}</h3>
                              <p className="help">
                                Revision {job.project_revision} ·{" "}
                                {new Date(job.created_at).toLocaleString()}
                              </p>
                              {job.error && (
                                <p className="inline-error">{job.error}</p>
                              )}
                              <div className="export-actions">
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    navigate("production", job.project_id)
                                  }
                                >
                                  Open project
                                  <ArrowRight size={14} />
                                </button>
                                {job.download_url && (
                                  <a
                                    className="button small-button"
                                    download
                                    href={job.download_url}
                                  >
                                    <Download size={15} />
                                    Download MP4
                                  </a>
                                )}
                              </div>
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <div className="surface">
                        <Empty
                          title="The spotlight is waiting"
                          action={
                            <button
                              className="button secondary"
                              onClick={() => navigate("production")}
                            >
                              Go to productions
                              <ArrowRight size={16} />
                            </button>
                          }
                        >
                          Your completed 1080 × 1920 videos will appear here.
                          Approve a script and upload narration to render your
                          first export.
                        </Empty>
                      </div>
                    ))}
                  {page === "templates" && (
                    <>
                      <div className="templates-grid">
                        {templates.map((t) => (
                          <section className="surface template-card" key={t.id}>
                            <span className="template-icon">
                              <Layers size={26} />
                            </span>
                            <span className="mini-tag">1080 × 1920</span>
                            <h3>{t.name}</h3>
                            <p>
                              {t.settings.fps} fps ·{" "}
                              {t.settings.transition === "fade"
                                ? "Dip to black"
                                : "Hard cuts"}{" "}
                              · {t.settings.default_duration}s scenes
                            </p>
                            <div className="template-details">
                              <span>
                                <Check size={14} />
                                {t.settings.default_motion.replaceAll("_", " ")}
                              </span>
                              <span>
                                <Check size={14} />
                                {t.settings.captions
                                  ? "Scene captions enabled"
                                  : "Captions disabled"}
                              </span>
                            </div>
                            <button
                              className="button secondary"
                              onClick={() => {
                                setPreferredTemplate(t.id);
                                setDialog("new");
                              }}
                            >
                              Use in a new project
                              <ArrowRight size={15} />
                            </button>
                          </section>
                        ))}
                      </div>
                      <div className="note">
                        <Layers size={19} />
                        <div>
                          <strong>Make it your signature.</strong>
                          <p>
                            Open a project’s Settings tab to customize motion,
                            timing, transitions, and captions, then save them as
                            a reusable template.
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                  {page === "connections" && (
                    <div className="connections-grid">
                      {[
                        {
                          icon: Sparkles,
                          title: "AI writing",
                          enabled: integrations.writing_enabled,
                          text: "An optional OpenAI-compatible writing API. Set CB_AI_BASE_URL, CB_AI_MODEL, and CB_AI_API_KEY on the server. Drafts always need human approval.",
                        },
                        {
                          icon: BookOpen,
                          title: "Authorized comic sources",
                          enabled: false,
                          text: "A source-provider interface is ready for authorized database integrations. The MVP imports your files. No scraping, DRM bypass, or paywall bypass.",
                        },
                        {
                          icon: AudioLinesIcon,
                          title: "Voice generation",
                          enabled: false,
                          text: "A voice-provider interface is available for future integration. Upload recorded narration to use the complete production pipeline today.",
                        },
                        {
                          icon: Link2,
                          title: "Social publishing",
                          enabled: false,
                          text: "Reserved for a later module. Download your MP4 and publish it manually. The studio does not connect to or post to social accounts.",
                        },
                      ].map(({ icon: Icon, title, enabled, text }) => (
                        <section
                          className="surface connection-card"
                          key={title}
                        >
                          <Icon size={24} />
                          <span
                            className={`mini-tag ${enabled ? "approved" : ""}`}
                          >
                            {enabled
                              ? "CONFIGURED"
                              : title === "AI writing"
                                ? "OPTIONAL"
                                : "FUTURE MODULE"}
                          </span>
                          <h3>{title}</h3>
                          <p>{text}</p>
                        </section>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <ShieldCheck size={13} /> Private workspace · local storage
            </span>
            <span>Built for the evidence. Powered by Verdict.</span>
          </footer>
        </main>
      </div>
      {toast}
      {dialog === "new" && (
        <NewProject
          templates={templates}
          initialTemplateId={preferredTemplate}
          onClose={() => {
            setDialog(null);
            setPreferredTemplate(undefined);
          }}
          onError={showError}
          onCreated={(project) => {
            setDialog(null);
            setPreferredTemplate(undefined);
            void refresh();
            navigate("production", project.id);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportPanels
          onClose={() => setDialog(null)}
          onError={showError}
          onImported={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {selectedPanel && (
        <PanelDetail
          panel={selectedPanel}
          onClose={() => setSelectedPanel(null)}
          onError={showError}
          onSaved={() => {
            setSelectedPanel(null);
            void refresh();
          }}
        />
      )}
      {dialog === "help" && (
        <Modal
          title="From evidence to final verdict"
          eyebrow="STUDIO GUIDE"
          onClose={() => setDialog(null)}
        >
          <ol className="guide-list">
            <li>
              <strong>Collect the evidence.</strong>
              <p>
                Import your authorized images, PDF, or CBZ. Open any panel to
                select a crop, resize it, and record series, issue, page,
                characters, and fight notes.
              </p>
            </li>
            <li>
              <strong>Build your production.</strong>
              <p>
                Create a project. Add panels to its timeline, drag them into
                order, and adjust timing, camera motion, and on-screen captions.
                Save the timeline.
              </p>
            </li>
            <li>
              <strong>Write the verdict.</strong>
              <p>
                Use panel-specific jokes and fight commentary. Aim for 65–90
                seconds. Save your draft, review it, then approve the script.
              </p>
            </li>
            <li>
              <strong>Bring it to life.</strong>
              <p>
                Upload narration and optional scene sound effects. Extend the
                timeline if needed to fit all speech. Save changes and click
                Render MP4.
              </p>
            </li>
            <li>
              <strong>Review and export.</strong>
              <p>
                Preview motion in the editor and review the actual video in
                Exports. Download your vertical MP4. Write a looping final line
                and play the export on repeat to review it.
              </p>
            </li>
          </ol>
        </Modal>
      )}
    </div>
  );
}

function AudioLinesIcon({ size }: { size?: number }) {
  return <Grid2X2 size={size} />;
}
