import { useEffect, useState } from "react";
import { api, json } from "./api";
import type { Recipe, Style } from "./ReferenceStyle";
import { errorMessage, timecode } from "./utils";

type Interpretation = {
  base_revision: number;
  summary: string;
  observations: {
    index: number;
    purpose: string;
    evidence: string;
    confidence: string;
  }[];
  unsupported_effects: string[];
  recipe: Recipe;
  shared_frames: number[];
  model: string;
};

export default function ReferenceUnderstanding({
  style,
  busy,
  run,
  onRecipe,
}: {
  style: Style;
  busy: boolean;
  run: (action: () => Promise<void>, saveFirst?: boolean) => Promise<void>;
  onRecipe: (recipe: Recipe) => void;
}) {
  const [configured, setConfigured] = useState(false),
    [model, setModel] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<Interpretation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<{ configured: boolean; model: string }>("/verdict/connection")
      .then((status) => {
        if (alive) {
          setConfigured(status.configured);
          setModel(status.model);
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setResult(null);
    setConsent(false);
  }, [style.id, style.revision]);
  return (
    <details className="reference-understanding">
      <summary>Ask a vision model to interpret this style · optional</summary>
      <p>
        A configured vision model can explain visible effects and suggest which
        beats are hits, reveals, reactions or reading holds. Review its
        interpretation before saving it.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!configured && (
        <p className="help">
          Connect a vision model in Verdict Autopilot to use this option. Local
          timing analysis and style editing work without it.
        </p>
      )}
      {configured && <p className="help">Configured model: {model}</p>}
      <label className="check-label">
        <input
          type="checkbox"
          aria-label="Share sampled reference frames with my vision model"
          disabled={busy || !configured}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        Send up to 18 sampled reference frames and the style measurements to my
        configured model for this request.
      </label>
      <p className="help">
        Your episode artwork, voice recording and provider credentials are
        excluded from the request body. Provider charges may apply. Sparse
        frames can miss or misinterpret effects.
      </p>
      <button
        className="button secondary"
        disabled={busy || !configured || !consent}
        onClick={() =>
          void run(async () => {
            setResult(
              await api<Interpretation>(
                `/reference-styles/${style.id}/understand`,
                json({ base_revision: style.revision, share_frames: true }),
              ),
            );
          }, false)
        }
      >
        Interpret reference with my vision model
      </button>
      {result && (
        <div aria-label="Vision style interpretation">
          <h4>Review the interpretation</h4>
          <p>{result.summary}</p>
          <ul>
            {result.observations.map((observation) => (
              <li key={observation.index}>
                <strong>
                  Beat {observation.index + 1} · {observation.purpose} ·{" "}
                  {observation.confidence}
                </strong>
                <p>{observation.evidence}</p>
              </li>
            ))}
          </ul>
          {!!result.unsupported_effects.length && (
            <>
              <p>
                These effects need manual work; they will not be substituted
                silently:
              </p>
              <ul>
                {result.unsupported_effects.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>Frames shared for this request</summary>
            <p className="help">
              {result.shared_frames.map(timecode).join(", ")}
            </p>
          </details>
          <button
            className="button secondary"
            disabled={busy || result.base_revision !== style.revision}
            onClick={() => {
              const reviewed = new Set(result.observations.map((o) => o.index));
              onRecipe({
                ...result.recipe,
                beats: result.recipe.beats.map((beat, i) =>
                  reviewed.has(i)
                    ? {
                        ...beat,
                        motion_reviewed: true,
                        transition_reviewed: true,
                      }
                    : beat,
                ),
              });
              setResult(null);
            }}
          >
            Use these reviewed suggestions in my recipe
          </button>
          <p className="help">
            This fills the recipe editor. Save the recipe, then preview an
            episode proposal before applying it.
          </p>
        </div>
      )}
    </details>
  );
}
