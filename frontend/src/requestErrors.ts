const fieldLabels: Record<string, string> = {
  title: "Project title",
  idea: "The angle",
  script: "Script",
  settings: "Video settings",
  base_revision: "Saved project version",
  scenes: "Shots",
  duration: "Duration (seconds)",
  autopilot: "Draft settings",
  enabled: "Automatic draft building",
  mode: "How Verdict decides",
  pace: "Pacing",
  delivery: "Delivery",
  rebuild_pages: "Re-detect panels",
  reorder_pages: "Reorder pages",
  voice_approved: "Narration approval",
  panel_id: "Source page",
  panel_ids: "Source pages",
  panel_organization: "Panel organization",
  organization: "Panel organization",
  pages: "Pages",
  regions: "Panels",
  prefix: "Panel naming prefix",
  crop: "Crop",
  source_crop: "Source crop",
  x: "Left edge",
  y: "Top edge",
  width: "Width",
  height: "Height",
  cues: "Captions",
  start: "Start time",
  end: "End time",
  file: "File",
  files: "Files",
  base_url: "AI provider address",
  model: "AI model",
  api_key: "API key",
  transcription_model: "Speech model",
  name: "Name",
  caption: "Caption",
  motion: "Camera motion",
  focus_x: "Horizontal camera focus",
  focus_y: "Vertical camera focus",
  transition_duration: "Transition duration (seconds)",
};

function fieldPath(value: unknown): string {
  if (!Array.isArray(value)) return "Request";
  const parts = value.filter(
    (part) => part !== "body" && part !== "query" && part !== "path",
  );
  const labels: string[] = [];
  for (const part of parts) {
    if (typeof part === "number") {
      const previous = labels.pop() ?? "Item";
      const singular =
        (
          {
            Shots: "Shot",
            Pages: "Page",
            Panels: "Panel",
            Captions: "Caption",
            Files: "File",
          } as Record<string, string>
        )[previous] ?? previous;
      labels.push(`${singular} ${part + 1}`);
    } else if (typeof part === "string") {
      labels.push(
        fieldLabels[part] ??
          part.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
      );
    }
  }
  return labels.join(" → ") || "Request";
}

export function requestError(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.msg !== "string")
        return [];
      const field = fieldPath(item.loc);
      let message = item.msg.replace(/^Value error, /i, "");
      if (item.type === "missing") message = "This is required.";
      if (Array.isArray(item.loc) && item.loc.includes("base_revision"))
        message =
          "Reload this production, then try again. Your files are kept.";
      else if (item.type === "extra_forbidden")
        message =
          "Studio sent a setting this version cannot accept. Close older Studio windows and open the newest EXE; you do not need to change a form field.";
      else if (
        item.type === "string_pattern_mismatch" &&
        Array.isArray(item.loc) &&
        item.loc.includes("prefix")
      )
        message =
          "Use letters, numbers, underscores or hyphens, such as ww_01.";
      return [`${field}: ${message}`];
    });
    const unique = [...new Set(messages)];
    if (unique.length) return unique.join("\n");
  }
  return status === 422
    ? "Studio could not validate the request, but returned no field details. Reload this production and try again; your files are kept."
    : `Request failed (${status}).`;
}
