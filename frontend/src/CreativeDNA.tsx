import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BookOpenCheck, BrainCircuit, Check, Plus, Undo2, X } from "lucide-react";
import { api, json } from "./api";
import { errorMessage } from "./utils";

type RuleStatus = "proposed" | "approved" | "rejected";
type RuleScope = "global" | "short" | "long";
type Category =
  | "humor"
  | "voice"
  | "story"
  | "pacing"
  | "panel"
  | "crop"
  | "captions"
  | "audio"
  | "other";

interface Rule {
  id: string;
  scope: RuleScope;
  category: Category;
  instruction: string;
  source: "creator" | "audience";
  status: RuleStatus;
  updated_at: string;
}

interface Feedback {
  id: string;
  project_id: string;
  project_revision: number;
  scene_id: string | null;
  category: Category;
  decision: "keep" | "change" | "one_off";
  note: string;
}

interface ObservedEdit {
  id: string;
  project_id: string;
  from_revision: number;
  to_revision: number;
  changes: Array<{
    target: string;
    scene_id?: string;
    fields?: string[];
    scene_count?: number;
  }>;
}

interface Overview {
  rules: Rule[];
  recent_feedback: Feedback[];
  observed_edits: ObservedEdit[];
  pagination: {
    limit: number;
    rule_offset: number;
    feedback_offset: number;
    edit_offset: number;
    totals: { rules: number; feedback: number; edits: number };
  };
}

const categories: Category[] = [
  "humor",
  "voice",
  "story",
  "pacing",
  "panel",
  "crop",
  "captions",
  "audio",
  "other",
];

export default function CreativeDNA() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<RuleScope>("global");
  const [category, setCategory] = useState<Category>("humor");
  const [ruleOffset, setRuleOffset] = useState(0);
  const [feedbackOffset, setFeedbackOffset] = useState(0);
  const [editOffset, setEditOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const url = `/creative-dna?rule_offset=${ruleOffset}&feedback_offset=${feedbackOffset}&edit_offset=${editOffset}`;
  async function refresh() {
    setOverview(await api<Overview>(url));
  }

  useEffect(() => {
    let alive = true;
    api<Overview>(url)
      .then((result) => {
        if (alive) setOverview(result);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [url]);

  async function createRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !instruction.trim()) return;
    setPending(true);
    setError("");
    try {
      await api("/creative-dna/rules", json({ instruction: instruction.trim(), scope, category }));
      setInstruction("");
      setMessage("Rule saved as a proposal. Approve it to affect new AI scripts.");
      if (ruleOffset > 0) setRuleOffset(0);
      else await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function decide(rule: Rule, status: RuleStatus) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api(
        `/creative-dna/rules/${rule.id}`,
        json({ status, expected_updated_at: rule.updated_at }, "PATCH"),
      );
      setMessage(status === "approved" ? "Verdict will use this rule in new scripts." : "Rule updated.");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="creative-dna surface" aria-label="Creative DNA rules">
      <header className="creative-dna-heading">
        <BrainCircuit size={30} />
        <div>
          <span className="eyebrow">VERDICT LEARNS YOUR TASTE</span>
          <h2>Creative DNA</h2>
          <p className="muted">
            Control the style Verdict uses when drafting new episodes. Nothing becomes
            permanent until you approve it.
          </p>
        </div>
      </header>
      {error && <p role="alert" className="notice">{error}</p>}
      {message && <p role="status" className="muted">{message}</p>}
      <form className="creative-dna-form" onSubmit={(e) => void createRule(e)}>
        <label>
          Teach Verdict a preference
          <textarea
            value={instruction}
            maxLength={500}
            required
            rows={3}
            placeholder="Example: After introducing a character, escalate the nicknames naturally. Avoid recycling the same punchlines."
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <div className="creative-dna-controls">
          <label>
            Format
            <select value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
              <option value="global">All videos</option>
              <option value="short">Shorts only</option>
              <option value="long">Long-form only</option>
            </select>
          </label>
          <label>
            Topic
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {categories.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <button className="button primary" type="submit" disabled={pending || instruction.trim().length < 3}>
            <Plus size={16} /> Save proposal
          </button>
        </div>
      </form>
      <div className="creative-dna-rule-list">
        <h3>Saved rules</h3>
        {!overview && !error && <p className="muted">Loading your rules…</p>}
        {overview && overview.rules.length === 0 && (
          <p className="muted">No lessons saved yet. Approved rules will guide future scripts.</p>
        )}
        {overview?.rules.map((rule) => (
          <article className="creative-dna-rule" key={rule.id}>
            <div>
              <span className="eyebrow">{rule.category} · {rule.scope} · {rule.status}</span>
              <p>{rule.instruction}</p>
            </div>
            <div className="toolbar">
              {rule.status !== "approved" && (
                <button className="button primary" disabled={pending} onClick={() => void decide(rule, "approved")}>
                  <Check size={15} /> Approve
                </button>
              )}
              {rule.status === "approved" && (
                <button className="button secondary" disabled={pending} onClick={() => void decide(rule, "rejected")}>
                  <X size={15} /> Disable
                </button>
              )}
              {rule.status === "rejected" && (
                <button className="button secondary" disabled={pending} onClick={() => void decide(rule, "proposed")}>
                  <Undo2 size={15} /> Restore proposal
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <Pager
        offset={ruleOffset}
        total={overview?.pagination.totals.rules ?? 0}
        limit={overview?.pagination.limit ?? 50}
        onChange={setRuleOffset}
        label="Saved rules"
      />
      <div className="creative-dna-rule-list">
        <h3><BookOpenCheck size={18} /> Recent episode feedback</h3>
        {overview?.recent_feedback.length === 0 && (
          <p className="muted">No feedback captured yet. Scene-level feedback collection is the next milestone.</p>
        )}
        {overview?.recent_feedback.map((feedback) => (
          <div className="creative-dna-rule" key={feedback.id}>
            <div>
              <span className="eyebrow">{feedback.category} · {feedback.decision} · revision {feedback.project_revision}</span>
              <p>{feedback.note || "No note"}</p>
            </div>
            <button
              className="button secondary"
              disabled={pending}
              aria-label="Remove feedback"
              onClick={async () => {
                setPending(true);
                try {
                  await api(`/creative-dna/feedback/${feedback.id}`, { method: "DELETE" });
                  await refresh();
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setPending(false);
                }
              }}
            >
              <X size={15} /> Remove
            </button>
          </div>
        ))}
      </div>
      <Pager
        offset={feedbackOffset}
        total={overview?.pagination.totals.feedback ?? 0}
        limit={overview?.pagination.limit ?? 50}
        onChange={setFeedbackOffset}
        label="Feedback"
      />
      <div className="creative-dna-rule-list">
        <h3>Observed timeline edits</h3>
        <p className="muted">
          These are saved changes, not automatic learning instructions. A change could
          be a creative improvement or a one-time production adjustment.
        </p>
        {overview?.observed_edits.length === 0 && (
          <p className="muted">No workspace edits observed yet.</p>
        )}
        {overview?.observed_edits.slice(0, 10).map((edit) => (
          <div className="creative-dna-rule" key={edit.id}>
            <div>
              <span className="eyebrow">
                Episode {edit.project_id.slice(0, 8)} · revision {edit.from_revision} → {edit.to_revision}
              </span>
              <p>
                {edit.changes
                  .map((change) =>
                    change.target === "overflow"
                      ? `${change.scene_count ?? 0} additional scenes`
                      : `${change.target === "scene" ? "Scene" : "Project"}: ${(change.fields ?? []).join(", ")}`,
                  )
                  .join(" · ")}
              </p>
            </div>
          </div>
        ))}
      </div>
      <Pager
        offset={editOffset}
        total={overview?.pagination.totals.edits ?? 0}
        limit={overview?.pagination.limit ?? 50}
        onChange={setEditOffset}
        label="Observed edits"
      />
      <p className="muted">
        Audience comments and analytics sync require separate permission-based platform
        connections. No accounts are being scraped or monitored yet.
      </p>
    </section>
  );
}

function Pager({
  offset,
  total,
  limit,
  onChange,
  label,
}: {
  offset: number;
  total: number;
  limit: number;
  onChange: (offset: number) => void;
  label: string;
}) {
  if (total <= limit) return null;
  return (
    <nav className="toolbar" aria-label={`${label} pages`}>
      <button
        className="button secondary small-button"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span className="muted">
        {Math.min(offset + 1, total)}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button
        className="button secondary small-button"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}
