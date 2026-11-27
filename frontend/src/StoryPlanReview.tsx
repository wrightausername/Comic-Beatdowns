import { timecode } from "./utils";
export type StoryMap = {
  panels: {
    id: string;
    page_id: string;
    order: number;
    characters: string[];
    dialogue: string;
    action: string;
    reaction: string;
    evidence: string;
    review_required: boolean;
  }[];
  beats: {
    start: number;
    end: number;
    text: string;
    beat: string;
    authored_panel_id: string | null;
    evidence: string;
    review_required: boolean;
  }[];
  limits: string;
};
export type NarrationAlignment = {
  source: string;
  precision: string;
  script_coverage: number | null;
  mismatches: { script: string; recording: string }[];
  review_required: boolean;
  limit: string;
};
export default function StoryPlanReview({
  story,
  alignment,
  timingChanges = 0,
  soundChoices = 0,
}: {
  story: StoryMap;
  alignment?: NarrationAlignment;
  timingChanges?: number;
  soundChoices?: number;
}) {
  return (
    <details className="story-plan-review">
      <summary>
        Story & timing plan · {story.panels.length} authored panels ·{" "}
        {story.beats.length} spoken beats
      </summary>
      <p>
        {alignment
          ? `Timing evidence: ${alignment.precision} boundaries. `
          : ""}
        {timingChanges} cuts adjusted to speech or pauses; {soundChoices}{" "}
        sound-design decisions.
      </p>
      {alignment?.script_coverage != null && (
        <p>
          Script text coverage: {Math.round(alignment.script_coverage * 100)}%.{" "}
          {alignment.review_required
            ? "Review wording against the recording."
            : "Text agrees with the supplied timing evidence."}
        </p>
      )}
      {!!alignment?.mismatches.length && (
        <details>
          <summary>Script / recording differences</summary>
          <ul>
            {alignment.mismatches.map((m, i) => (
              <li key={i}>
                Script: {m.script || "(none)"} · Timed speech:{" "}
                {m.recording || "(none)"}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ol className="story-panel-list">
        {story.panels.map((panel) => (
          <li key={panel.id}>
            <strong>
              Panel {panel.order}
              {panel.review_required ? " · check interpretation" : ""}
            </strong>
            <p>
              {[panel.characters.join(", "), panel.action, panel.reaction]
                .filter(Boolean)
                .join(" · ") || panel.evidence}
            </p>
            {panel.dialogue && <blockquote>{panel.dialogue}</blockquote>}
          </li>
        ))}
      </ol>
      <details>
        <summary>Narration → panel connections</summary>
        <ol>
          {story.beats.map((beat, i) => (
            <li key={i}>
              <strong>
                {timecode(beat.start)} · {beat.beat}
              </strong>{" "}
              {beat.text}
              <p className="help">
                {beat.authored_panel_id
                  ? `Panel ${story.panels.find((p) => p.id === beat.authored_panel_id)?.order ?? "?"}`
                  : "Panel match needs review"}{" "}
                · {beat.evidence}
              </p>
            </li>
          ))}
        </ol>
      </details>
      <p className="help">
        {story.limits} {alignment?.limit}
      </p>
    </details>
  );
}
