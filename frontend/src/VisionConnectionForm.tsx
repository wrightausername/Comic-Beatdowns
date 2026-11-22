import { useEffect, useState } from "react";
import { api, json } from "./api";
import type { VisionConnection } from "./types";
import { errorMessage } from "./utils";

// Shared by the existing Autopilot card and its one-screen creation intake.
export default function VisionConnectionForm({
  connection,
  onSaved,
  disabled = false,
  expanded = false,
}: {
  connection: VisionConnection | null;
  onSaved: (value: VisionConnection) => void;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const [form, setForm] = useState({
    base_url: "https://api.openai.com/v1",
    model: "",
    transcription_model: "",
    api_key: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (connection?.configured)
      setForm({
        base_url: connection.base_url,
        model: connection.model,
        transcription_model: connection.transcription_model,
        api_key: "",
      });
  }, [connection]);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const value = await api<VisionConnection>(
        "/verdict/connection",
        json({ ...form, api_key: form.api_key || null }, "PUT"),
      );
      setForm((old) => ({ ...old, api_key: "" }));
      onSaved(value);
      setMessage(
        "Connection saved. Select Vision and authorize its use before sending artwork. The model is checked when Verdict runs.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      onSaved(
        await api<VisionConnection>("/verdict/connection", {
          method: "DELETE",
        }),
      );
      setForm((old) => ({ ...old, api_key: "" }));
      setMessage("Connection and key removed.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="autopilot-connection" open={expanded}>
      <summary>Optional: connect Verdict’s vision AI</summary>
      <p className="muted">
        Use an OpenAI-compatible vision model, including a local server such as
        Ollama. Saving a connection does not send artwork. The key stays in this
        studio’s private data folder and is never returned to the browser.
      </p>
      <fieldset className="studio-fieldset" disabled={busy || disabled}>
        <div className="form-grid">
          <label>
            API base URL
            <input
              type="url"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="http://localhost:11434/v1"
            />
          </label>
          <label>
            Vision model
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="Your provider’s image-capable model"
            />
          </label>
          <label>
            API key {connection?.has_key && "(saved; leave blank to keep)"}
            <input
              type="password"
              autoComplete="new-password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder="Optional for local servers"
            />
          </label>
          <label>
            Speech model (optional)
            <input
              value={form.transcription_model}
              onChange={(e) =>
                setForm({ ...form, transcription_model: e.target.value })
              }
              placeholder="Blank = offline English captions"
            />
          </label>
        </div>
        <p className="muted">
          Speech models must support verbose_json timestamps. A configured
          Speech model can receive narration audio only in Vision mode. Provider
          charges may apply; local Basic remains available.
        </p>
        <div className="toolbar">
          <button
            type="button"
            className="button secondary"
            onClick={() => void save()}
          >
            Save AI connection
          </button>
          {connection?.configured && (
            <button
              type="button"
              className="text-button"
              onClick={() => void remove()}
            >
              Remove connection & key
            </button>
          )}
        </div>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
