import type { IntakeCheck } from "./types";

export interface IntakeFile {
  id: string;
  file: File;
  kind: string;
  status: "pending" | "imported" | "error";
  error?: string;
  duration?: number | null;
}
export const intakeRoles = [
  "unknown",
  "panels",
  "narration",
  "music",
  "sfx",
  "script",
  "captions",
];
export function stagedChecks(files: IntakeFile[]): IntakeCheck[] {
  const checks: IntakeCheck[] = [];
  const add = (code: string, ok: boolean, message: string) =>
    checks.push({
      code,
      state: ok ? "ready" : "blocking",
      message,
      confirm: false,
    });
  const voices = files.filter((f) => f.kind === "narration");
  add(
    "artwork",
    files.some((f) => f.kind === "panels"),
    "Select authorized artwork. Image, PDF and CBZ contents are validated during import.",
  );
  add(
    "voice",
    voices.length === 1,
    voices.length > 1
      ? "Choose exactly one narration recording. Reclassify other audio as music or sound effects."
      : "One Verdict narration recording is required. Script-only production and voice synthesis are not available.",
  );
  add(
    "roles",
    !files.some((f) => f.kind === "unknown"),
    "Confirm the file roles below; unknown files need an explicit role or removal.",
  );
  add(
    "limits",
    files.length <= 20 && files.every((f) => f.file.size <= 64 * 1024 * 1024),
    "At most 20 selected files; each file must be at most 64 MiB (65 MiB request ceiling including form overhead).",
  );
  for (const kind of ["script", "captions"])
    add(
      kind,
      files.filter((f) => f.kind === kind).length <= 1,
      `Use at most one optional ${kind === "script" ? "TXT/MD script" : "SRT caption file"}.`,
    );
  const signatures = files.map(
    (f) => `${f.file.name}\0${f.file.size}\0${f.file.lastModified}`,
  );
  add(
    "duplicates",
    new Set(signatures).size === signatures.length,
    "Remove duplicate file selections before uploading.",
  );
  if (voices.length === 1 && voices[0].duration != null) {
    const duration = voices[0].duration;
    add(
      "length",
      Number.isFinite(duration) && duration >= 0.25 && duration <= 180,
      `Recording length: ${Number.isFinite(duration) ? duration.toFixed(2) : "invalid"} seconds (0.25–180 allowed).`,
    );
    if (Number.isFinite(duration) && (duration < 65 || duration > 90))
      checks.push({
        code: "target",
        state: "notice",
        message:
          "65–90 seconds is advisory; your recording will not be shortened to match it.",
        confirm: false,
      });
  }
  return checks;
}
export function probeNarration(file: File): Promise<number | null> {
  if (typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const player = document.createElement("audio");
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      player.onloadedmetadata = null;
      player.onerror = null;
      player.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 10_000);
    player.preload = "metadata";
    player.onloadedmetadata = () =>
      finish(Number.isFinite(player.duration) ? player.duration : null);
    player.onerror = () => finish(null); // FFmpeg remains authoritative for browser-unsupported codecs.
    player.src = url;
  });
}
