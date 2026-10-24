import { useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import { Check, FileImage, Plus, Scissors, Upload, X } from "lucide-react";
import { api, json } from "./api";
import { Modal } from "./components";
import BrandOptions from "./BrandOptions";
import {
  defaultAutopilot,
  handToVerdict,
  orderForProduction,
} from "./VerdictAutopilot";
import { guessKind } from "./ProductionWorkflow";
import type {
  AutopilotOptions,
  Easing,
  Motion,
  Panel,
  Project,
  Template,
  Transition,
  VideoSettings,
} from "./types";
import {
  EasingOptions,
  MotionOptions,
  TransitionOptions,
} from "./EffectOptions";
import { errorMessage } from "./utils";

type SuggestedPanelCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type ErrorHandler = (message: string) => void;
const initialMetadata = {
  title: "",
  series: "",
  issue: "",
  page: "",
  characters: "",
  fight: "",
};
type Metadata = typeof initialMetadata;

function MetadataFields({
  values,
  change,
}: {
  values: Metadata;
  change: (values: Metadata) => void;
}) {
  return (
    <div className="form-grid">
      <label className="span-2">
        Panel title
        <input
          value={values.title}
          maxLength={200}
          onChange={(e) => change({ ...values, title: e.target.value })}
          placeholder="The moment it all went wrong"
        />
      </label>
      <label>
        Comic series
        <input
          value={values.series}
          maxLength={200}
          onChange={(e) => change({ ...values, series: e.target.value })}
          placeholder="Series name"
        />
      </label>
      <label>
        Issue number
        <input
          value={values.issue}
          maxLength={50}
          onChange={(e) => change({ ...values, issue: e.target.value })}
          placeholder="#12"
        />
      </label>
      <label>
        Page / starting page
        <input
          type="number"
          min="1"
          max="10000"
          value={values.page}
          onChange={(e) => change({ ...values, page: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <label>
        Characters
        <input
          value={values.characters}
          maxLength={500}
          onChange={(e) => change({ ...values, characters: e.target.value })}
          placeholder="Who’s throwing hands?"
        />
      </label>
      <label className="span-2">
        Fight notes
        <textarea
          rows={3}
          maxLength={4000}
          value={values.fight}
          onChange={(e) => change({ ...values, fight: e.target.value })}
          placeholder="What happens in this panel? Record the evidence."
        />
      </label>
    </div>
  );
}

export function NewProject({
  templates,
  initialTemplateId,
  initialAutopilot = false,
  onClose,
  onCreated,
  onError,
}: {
  templates: Template[];
  initialTemplateId?: string;
  initialAutopilot?: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
  onError: ErrorHandler;
}) {
  const [autopilot, setAutopilot] = useState(initialAutopilot);
  const [directorOptions, setDirectorOptions] =
    useState<AutopilotOptions>(defaultAutopilot);
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [template, setTemplate] = useState(
    initialTemplateId ?? templates[0]?.id ?? "",
  );
  const [files, setFiles] = useState<{ file: File; kind: string }[]>([]);
  const [busy, setBusy] = useState(false);
  function addProjectFiles(chosen: File[]) {
    setFiles((old) => [
      ...old,
      ...chosen.map((file) => ({ file, kind: guessKind(file.name) })),
    ]);
    if (!title && chosen.length)
      setTitle(chosen[0].name.replace(/\.[^.]+$/, "").slice(0, 200));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const orderedFiles = orderForProduction(files);
      let created = await api<Project>(
        "/projects",
        json({ title, idea, template_id: template || null }),
      );
      if (autopilot)
        created = await api<Project>(
          `/projects/${created.id}/autopilot`,
          json(
            {
              ...directorOptions,
              enabled: true,
              base_revision: created.revision,
            },
            "PUT",
          ),
        );
      let failed = false;
      for (const item of orderedFiles) {
        try {
          const body = new FormData();
          body.append("file", item.file);
          body.append("kind", item.kind);
          const result = await api<{ project: Project }>(
            `/projects/${created.id}/import-file`,
            { method: "POST", body },
          );
          created = result.project;
        } catch (error) {
          failed = true;
          onError(
            `${item.file.name}: ${errorMessage(error)}. Add it again in step 1.`,
          );
        }
      }
      if (!failed) {
        try {
          await handToVerdict(created);
        } catch (error) {
          onError(errorMessage(error));
        }
      }
      onCreated(created);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Start a new beatdown"
      eyebrow="THE NEXT VERDICT"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label className="autopilot-review">
          <input
            type="checkbox"
            checked={autopilot}
            onChange={(e) => setAutopilot(e.target.checked)}
          />
          Let Verdict handle the edit after upload
        </label>
        <p className="muted">
          Autopilot builds and renders a preview from your panels and voice. No
          API key needed. Connect vision AI inside the project for artwork
          understanding.
        </p>
        {autopilot && (
          <div className="form-grid">
            <label>
              Verdict mode
              <select
                value={directorOptions.mode}
                onChange={(e) =>
                  setDirectorOptions({
                    ...directorOptions,
                    mode: e.target.value as AutopilotOptions["mode"],
                  })
                }
              >
                <option value="basic">Basic · local, no API key</option>
                <option value="vision">
                  Vision AI · saved connection required
                </option>
              </select>
            </label>
            <label>
              Editing pace
              <select
                value={directorOptions.pace}
                onChange={(e) =>
                  setDirectorOptions({
                    ...directorOptions,
                    pace: e.target.value as AutopilotOptions["pace"],
                  })
                }
              >
                <option value="fast">Fast · punchy Shorts camera</option>
                <option value="slow">Slow · longer readable shots</option>
              </select>
            </label>
            <label>
              Verdict delivery
              <select
                value={directorOptions.delivery}
                onChange={(e) =>
                  setDirectorOptions({
                    ...directorOptions,
                    delivery: e.target.value as AutopilotOptions["delivery"],
                  })
                }
              >
                <option value="draft">Preview first · I approve</option>
                <option value="final">
                  Finish for me · automatic 1080p MP4
                </option>
              </select>
            </label>
            {directorOptions.delivery === "final" && (
              <p className="notice">
                You authorize Verdict to approve and render the final edit
                automatically.
              </p>
            )}
            {directorOptions.mode === "vision" && (
              <p className="muted">
                Uses your saved AI connection and sends resized panels and
                narration text to that provider. Speech audio is sent only if a
                Speech model is saved. Provider charges may apply. Connect the
                model inside an existing project first.
              </p>
            )}
          </div>
        )}
        <div
          className="project-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addProjectFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <strong>Drop files to start your episode</strong>
          <label className="button secondary">
            Choose project files
            <input
              type="file"
              aria-label="New project files"
              hidden
              multiple
              accept="image/*,.pdf,.cbz,audio/*,.srt"
              onChange={(e) => {
                addProjectFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {files.map((item, index) => (
          <div className="import-file-row" key={index}>
            <span>{item.file.name}</span>
            <select
              aria-label={`New project role for ${item.file.name}`}
              value={item.kind}
              onChange={(e) =>
                setFiles((old) =>
                  old.map((v, i) =>
                    i === index ? { ...v, kind: e.target.value } : v,
                  ),
                )
              }
            >
              {["panels", "narration", "music", "sfx", "captions"].map(
                (kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ),
              )}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove new file ${item.file.name}`}
              onClick={() =>
                setFiles((old) => old.filter((_, i) => i !== index))
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <label>
          Project title
          <input
            autoFocus
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A fight worth talking about"
          />
        </label>
        <label>
          The angle
          <textarea
            rows={4}
            maxLength={8000}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="What makes this fight ridiculous? Start with a hook."
          />
        </label>
        <label>
          Video template
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <p className="help">
          Vertical 1080 × 1920. Aim for 65–90 seconds of panel-specific
          commentary.
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy || !title.trim()}>
            <Plus size={16} />
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ImportPanels({
  onClose,
  onImported,
  onError,
}: {
  onClose: () => void;
  onImported: () => void;
  onError: ErrorHandler;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      body.append(
        "metadata",
        JSON.stringify({
          ...metadata,
          page: metadata.page ? Number(metadata.page) : null,
        }),
      );
      await api<Panel[]>("/panels/import", { method: "POST", body });
      onImported();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Bring in the evidence"
      eyebrow="PANEL IMPORT"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit}>
        <div className="import-layout">
          <div>
            <button
              type="button"
              className="drop-zone"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={28} />
              <strong>Drop your source files here</strong>
              <span>or click to browse</span>
              <small>Images, PDF, CBZ · 64 MB per batch · 100 pages max</small>
            </button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Source files"
              hidden
              multiple
              accept="image/*,.pdf,.cbz"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <div className="file-list">
              {files.map((file, i) => (
                <div key={`${file.name}-${i}`}>
                  <FileImage size={16} />
                  <span>
                    {file.name}
                    <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles(files.filter((_, index) => index !== i))
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="help">
              Use files you own or are authorized to use. Source pages stay
              intact; crops create new panels. Metadata applies to this batch.
            </p>
          </div>
          <MetadataFields values={metadata} change={setMetadata} />
        </div>
        <div className="modal-actions">
          <span className="muted">
            {files.length} file{files.length !== 1 && "s"} selected
          </span>
          <button className="button" disabled={busy || !files.length}>
            <Upload size={16} />
            {busy ? "Importing pages…" : "Import to library"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PanelDetail({
  panel,
  onClose,
  onSaved,
  onError,
}: {
  panel: Panel;
  onClose: () => void;
  onSaved: () => void;
  onError: ErrorHandler;
}) {
  const [metadata, setMetadata] = useState<Metadata>({
    title: panel.title,
    series: panel.series,
    issue: panel.issue,
    page: panel.page?.toString() ?? "",
    characters: panel.characters,
    fight: panel.fight,
  });
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [outputWidth, setOutputWidth] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedPanelCrop[] | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [detectMessage, setDetectMessage] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);
  async function detectPanels() {
    setBusy(true);
    try {
      const response = await api<{ candidates: SuggestedPanelCrop[]; notice: string }>(
        `/panels/${panel.id}/smart-crops`,
      );
      setSuggestions(response.candidates);
      setChosen(response.candidates.map((_, i) => i));
      setDetectMessage(
        response.candidates.length
          ? response.notice
          : "No clear straight gutters found. This page needs manual cropping.",
      );
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function acceptPanels() {
    setBusy(true);
    try {
      await api(`/panels/${panel.id}/smart-crops`, json({ indices: chosen }));
      onSaved();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }
  function cropStart(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
  }
  function cropMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const p = point(e),
      a = start.current;
    setCrop({
      x: Math.min(p.x, a.x),
      y: Math.min(p.y, a.y),
      width: Math.abs(p.x - a.x),
      height: Math.abs(p.y - a.y),
    });
  }
  async function save(asCrop: boolean) {
    setBusy(true);
    try {
      await api(
        `/panels/${panel.id}`,
        json(
          { ...metadata, page: metadata.page ? Number(metadata.page) : null },
          "PATCH",
        ),
      );
      if (asCrop)
        await api(
          `/panels/${panel.id}/crop`,
          json({
            ...crop,
            output_width: outputWidth ? Number(outputWidth) : null,
          }),
        );
      onSaved();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={panel.title} eyebrow="PANEL WORKSPACE" onClose={onClose} wide>
      <div className="import-layout">
        <div>
          <p className="help">
            Drag a rectangle on the image to select a crop.
          </p>
          <div
            className="crop-stage"
            onPointerDown={cropStart}
            onPointerMove={cropMove}
            onPointerUp={() => {
              start.current = null;
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
          >
            <img src={panel.image_url} alt={panel.title} draggable={false} />
            <span
              className="crop-selection"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
            />
            {suggestions?.map((suggestion, index) => (
              <span
                key={index}
                className="crop-selection"
                aria-hidden="true"
                style={{
                  left: `${suggestion.x * 100}%`,
                  top: `${suggestion.y * 100}%`,
                  width: `${suggestion.width * 100}%`,
                  height: `${suggestion.height * 100}%`,
                  outline: chosen.includes(index)
                    ? "3px solid #53ebdb"
                    : "2px dashed #dd9e56",
                  pointerEvents: "none",
                }}
              />
            ))}
          </div>
          <div className="crop-info">
            <span>
              {panel.width} × {panel.height} px
            </span>
            <button
              className="text-button"
              onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 1 })}
            >
              Reset selection
            </button>
          </div>
          <div className="smart-panel-detect">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void detectPanels()}
            >
              <Scissors size={16} /> Detect comic panels
            </button>
            {detectMessage && <p className="help">{detectMessage}</p>}
            {suggestions && suggestions.length > 0 && (
              <>
                <div className="smart-panel-choices">
                  {suggestions.map((suggestion, index) => (
                    <label className="check-label" key={index}>
                      <input
                        type="checkbox"
                        checked={chosen.includes(index)}
                        onChange={(e) =>
                          setChosen((before) =>
                            e.target.checked
                              ? [...before, index]
                              : before.filter((value) => value !== index),
                          )
                        }
                      />
                      Panel {index + 1} · suggested region
                    </label>
                  ))}
                </div>
                <button
                  className="button"
                  disabled={busy || chosen.length === 0}
                  onClick={() => void acceptPanels()}
                >
                  Create {chosen.length} selected panel crops
                </button>
              </>
            )}
          </div>
          <label>
            Resize crop to width (px)
            <input
              type="number"
              min="16"
              max="4096"
              placeholder="Keep crop size"
              value={outputWidth}
              onChange={(e) => setOutputWidth(e.target.value)}
            />
          </label>
          <p className="help">
            Aspect ratio is preserved. Source: {panel.source_name}
            {panel.parent_id && " · derived crop"}
          </p>
        </div>
        <MetadataFields values={metadata} change={setMetadata} />
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void save(false)}
        >
          <Check size={16} />
          Save metadata
        </button>
        <button
          className="button"
          disabled={busy || crop.width <= 0.005 || crop.height <= 0.005}
          onClick={() => void save(true)}
        >
          <Scissors size={16} />
          {busy ? "Saving…" : "Save as new panel"}
        </button>
      </div>
    </Modal>
  );
}

export function PanelPicker({
  panels,
  onClose,
  onAdd,
}: {
  panels: Panel[];
  onClose: () => void;
  onAdd: (panels: Panel[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const filtered = panels.filter((p) =>
    `${p.title} ${p.series} ${p.characters} ${p.fight}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Modal
      title="Choose your panels"
      eyebrow="BUILD THE TIMELINE"
      onClose={onClose}
      wide
    >
      <input
        aria-label="Search panels to add"
        placeholder="Search panels, characters, or series…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="picker-grid">
        {filtered.map((panel) => (
          <button
            className={`picker-card ${selected.includes(panel.id) ? "selected" : ""}`}
            key={panel.id}
            onClick={() =>
              setSelected(
                selected.includes(panel.id)
                  ? selected.filter((id) => id !== panel.id)
                  : [...selected, panel.id],
              )
            }
          >
            <img src={panel.thumbnail_url} alt={panel.title} />
            <span>{panel.title}</span>
            {selected.includes(panel.id) && (
              <i>
                <Check size={16} />
              </i>
            )}
          </button>
        ))}
      </div>
      {!filtered.length && (
        <p className="help">
          No panels yet. Import your images, PDF, or CBZ into the panel library
          first.
        </p>
      )}
      <div className="modal-actions">
        <span className="muted">Selection order becomes scene order</span>
        <button
          className="button"
          disabled={!selected.length}
          onClick={() =>
            onAdd(selected.map((id) => panels.find((p) => p.id === id)!))
          }
        >
          <Plus size={16} />
          Add {selected.length || ""} panels
        </button>
      </div>
    </Modal>
  );
}

export function VideoOptions({
  value,
  onChange,
}: {
  value: VideoSettings;
  onChange: (value: VideoSettings) => void;
}) {
  return (
    <div className="form-grid">
      <label>
        Frame rate
        <select
          value={value.fps}
          onChange={(e) =>
            onChange({ ...value, fps: Number(e.target.value) as 24 | 30 })
          }
        >
          <option value={24}>24 fps · cinematic</option>
          <option value={30}>30 fps · smooth</option>
        </select>
      </label>
      <label>
        Transition
        <select
          value={value.transition}
          onChange={(e) =>
            onChange({ ...value, transition: e.target.value as Transition })
          }
        >
          <TransitionOptions />
        </select>
      </label>
      <label>
        Transition duration (seconds)
        <input
          type="number"
          min="0.08"
          max="0.8"
          step="0.01"
          value={value.transition_duration}
          disabled={value.transition === "cut"}
          onChange={(e) =>
            onChange({ ...value, transition_duration: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Default scene duration
        <input
          type="number"
          min="0.25"
          max="30"
          step="0.25"
          value={value.default_duration}
          onChange={(e) =>
            onChange({ ...value, default_duration: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Default motion
        <select
          value={value.default_motion}
          onChange={(e) =>
            onChange({ ...value, default_motion: e.target.value as Motion })
          }
        >
          <MotionOptions />
        </select>
      </label>
      <label>
        Default movement strength ·{" "}
        {Math.round(value.default_motion_strength * 100)}%
        <input
          type="range"
          min="0.02"
          max="0.3"
          step="0.01"
          value={value.default_motion_strength}
          onChange={(e) =>
            onChange({
              ...value,
              default_motion_strength: Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        Default motion easing
        <select
          value={value.default_easing}
          onChange={(e) =>
            onChange({ ...value, default_easing: e.target.value as Easing })
          }
        >
          <EasingOptions />
        </select>
      </label>
      <label className="checkbox span-2">
        <input
          type="checkbox"
          checked={value.captions}
          onChange={(e) => onChange({ ...value, captions: e.target.checked })}
        />
        Burn captions into the export
      </label>
      <BrandOptions value={value} onChange={onChange} />
    </div>
  );
}
