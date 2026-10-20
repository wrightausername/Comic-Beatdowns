import { useEffect, useState } from "react";
import { CloudUpload, Link2, RefreshCw, Send } from "lucide-react";
import { api, json } from "./api";
import type { RenderJob } from "./types";
import { errorMessage } from "./utils";

type Connection = {
  buffer_configured: boolean;
  cloudinary_configured: boolean;
  cloud_name: string;
};
type Channel = {
  id: string;
  service: "facebook" | "instagram" | "tiktok" | "youtube";
  name: string;
  paused: boolean;
};
type Attempt = {
  render_id: string;
  channel_id: string;
  channel: string;
  service: string;
  status: string;
  post_id: string | null;
  mode: string;
  message: string;
  already_submitted?: boolean;
};
type SendResult = { results: Attempt[]; media_hosted: boolean };
const labels: Record<Channel["service"], string> = {
  facebook: "Facebook Reels",
  instagram: "Instagram Reels",
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
};

export default function PublishingDesk({ jobs }: { jobs: RenderJob[] }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [keys, setKeys] = useState({
    buffer_api_key: "", cloud_name: "", cloud_api_key: "", cloud_api_secret: "",
  });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [renderId, setRenderId] = useState("");
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"draft" | "queue">("draft");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const eligible = jobs.filter((j) => j.status === "completed" && j.quality === "final" && !j.section);
  const activeRender = eligible.find((j) => j.id === renderId);

  async function refresh() {
    const [status, past] = await Promise.all([
      api<Connection>("/publishing/status"),
      api<Attempt[]>("/publishing/history"),
    ]);
    setConnection(status);
    setHistory(past);
    if (status.buffer_configured) {
      setChannels(await api<Channel[]>("/publishing/channels"));
    } else {
      setChannels([]);
    }
  }
  useEffect(() => { void refresh().catch((e) => setMessage(errorMessage(e))); }, []);
  useEffect(() => {
    if (eligible.length && !eligible.some((job) => job.id === renderId)) {
      setRenderId(eligible[0].id);
    }
  }, [jobs, renderId]);
  useEffect(() => {
    setCaption("");
    setTitle(activeRender?.title.slice(0, 100) ?? "");
    setApproved(false);
  }, [renderId]);

  async function saveKeys() {
    setBusy(true);
    setMessage("");
    try {
      await api<Connection>("/publishing/connection", json(keys, "PUT"));
      setKeys({ buffer_api_key: "", cloud_name: "", cloud_api_key: "", cloud_api_secret: "" });
      await refresh();
      setMessage("Connection settings saved locally. Keys are never returned to the browser.");
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!activeRender || !selected.length || !approved || !caption.trim()) return;
    const confirmation = mode === "queue"
      ? "Queue this video to " + selected.length + " connected channels in Buffer?"
      : "Save drafts for " + selected.length + " channels in Buffer?";
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setMessage("Uploading the MP4 to public media hosting and preparing Buffer posts...");
    try {
      const result = await api<SendResult>("/publishing/send", json({
        render_id: renderId,
        channel_ids: selected,
        caption,
        youtube_title: title,
        mode,
      }));
      setMessage(result.results.map((item) =>
        item.channel + ": " + item.status +
        (item.already_submitted ? " (previously submitted)" : "") +
        (item.message ? " · " + item.message : ""),
      ).join("\n"));
      await refresh();
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="publishing-desk">
      <section className="surface">
        <div className="section-heading">
          <div>
            <h2><Link2 size={20} /> Connect your publishing accounts</h2>
            <p>Connect Facebook, Instagram, TikTok, and YouTube in Buffer. Studio uses your Buffer API key and hosts MP4s with Cloudinary.</p>
          </div>
          <button className="button secondary small-button" disabled={busy} onClick={() => void refresh().catch((e) => setMessage(errorMessage(e)))}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        <p className="help">Buffer: {connection?.buffer_configured ? "Configured" : "Not configured"} · Cloudinary: {connection?.cloudinary_configured ? "Configured" : "Not configured"}. Your social network passwords are never stored in Studio.</p>
        <details className="publishing-settings">
          <summary>Set up or update publishing credentials</summary>
          <p className="help">
            Link channels at <a href="https://publish.buffer.com" target="_blank" rel="noreferrer">Buffer</a>, create an API key in Buffer Settings → API, and obtain Cloudinary credentials from its dashboard. Empty fields preserve existing values.
          </p>
          <div className="form-grid">
            <label>Buffer API key<input type="password" autoComplete="off" value={keys.buffer_api_key} onChange={(e) => setKeys({ ...keys, buffer_api_key: e.target.value })} /></label>
            <label>Cloudinary cloud name<input autoComplete="off" value={keys.cloud_name} placeholder={connection?.cloud_name || ""} onChange={(e) => setKeys({ ...keys, cloud_name: e.target.value })} /></label>
            <label>Cloudinary API key<input type="password" autoComplete="off" value={keys.cloud_api_key} onChange={(e) => setKeys({ ...keys, cloud_api_key: e.target.value })} /></label>
            <label>Cloudinary API secret<input type="password" autoComplete="off" value={keys.cloud_api_secret} onChange={(e) => setKeys({ ...keys, cloud_api_secret: e.target.value })} /></label>
          </div>
          <div className="workflow-actions">
            <button className="button small-button" disabled={busy || !Object.values(keys).some((value) => value.trim())} onClick={() => void saveKeys()}>
              Save private connection
            </button>
            <button className="text-button" disabled={busy || !connection?.buffer_configured} onClick={() => {
              if (!window.confirm("Remove saved Studio publishing credentials? Posts already sent to Buffer will remain there.")) return;
              setBusy(true);
              void api("/publishing/connection", { method: "DELETE" })
                .then(() => refresh())
                .then(() => setMessage("Publishing credentials removed from Studio."))
                .catch((e) => setMessage(errorMessage(e)))
                .finally(() => setBusy(false));
            }}>Disconnect Studio</button>
          </div>
        </details>
      </section>
      <section className="surface">
        <div className="section-heading">
          <div>
            <h2><CloudUpload size={20} /> Queue an approved video</h2>
            <p>Choose a finished export and destinations. Nothing is submitted without your approval.</p>
          </div>
        </div>
        <label>Final MP4 export
          <select value={renderId} onChange={(e) => setRenderId(e.target.value)}>
            {eligible.length === 0 && <option value="">No final exports yet</option>}
            {eligible.map((job) => <option value={job.id} key={job.id}>
              {job.title} · revision {job.project_revision} · {new Date(job.created_at).toLocaleDateString()}
            </option>)}
          </select>
        </label>
        <div className="publishing-channels" role="group" aria-label="Publishing destinations">
          {channels.map((channel) => (
            <label key={channel.id}>
              <input type="checkbox" checked={selected.includes(channel.id)} disabled={busy} onChange={(e) =>
                setSelected((old) => e.target.checked ? [...old, channel.id] : old.filter((id) => id !== channel.id))
              } />
              <strong>{labels[channel.service]}</strong>
              <span>{channel.name}{channel.paused ? " · Queue paused in Buffer" : ""}</span>
            </label>
          ))}
          {!channels.length && <p className="help">No supported channels connected yet. Connect your Facebook Page, Instagram professional account, TikTok, and YouTube in Buffer, then refresh.</p>}
        </div>
        <div className="form-grid">
          <label>YouTube Shorts title<input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Delivery
            <select value={mode} onChange={(e) => { setMode(e.target.value as "draft" | "queue"); setApproved(false); }}>
              <option value="draft">Save drafts in Buffer (best for your first test)</option>
              <option value="queue">Add to Buffer publishing queue</option>
            </select>
          </label>
        </div>
        <label>Post caption
          <textarea rows={5} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption, hashtags, and call to action..." />
        </label>
        <label className="publishing-approval">
          <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
          <span>I reviewed the final video, own or have permission to use its media, and approve public Cloudinary hosting and submission to Buffer.</span>
        </label>
        <p className="help">Buffer controls publication timing. Drafts remain unpublished; queued posts are scheduled according to each channel's Buffer settings. Check Buffer for platform-specific notifications.</p>
        <button className="button" disabled={busy || !connection?.buffer_configured || !connection?.cloudinary_configured || !activeRender || !selected.length || !caption.trim() || !approved} onClick={() => void send()}>
          <Send size={16} /> {busy ? "Submitting..." : mode === "queue" ? "Queue selected channels" : "Create Buffer drafts"}
        </button>
        {message && <p role="status" className="publishing-message">{message}</p>}
      </section>
      <section className="surface">
        <h3>Publishing history</h3>
        <p className="help">Accepted into Buffer doesn't mean live. Verify delivery in Buffer. Submissions with uncertain outcomes are not retried automatically to prevent duplicate posts.</p>
        {history.length ? history.map((item) => (
          <div className="publishing-history-row" key={item.render_id + ":" + item.channel_id}>
            <strong>{item.service} · {item.channel}</strong>
            <span>{item.status}{item.post_id ? " · Buffer post " + item.post_id : ""}</span>
            {item.message && <small>{item.message}</small>}
          </div>
        )) : <p className="help">No video uploads submitted yet.</p>}
      </section>
    </div>
  );
}
