import type { CaptionCue, Scene } from "./types";

export type PerformanceKind =
  | "disbelief"
  | "frustrated"
  | "shouting"
  | "sarcastic"
  | "deadpan"
  | "whisper"
  | "escalating"
  | "pause"
  | "emphasis";

export interface PerformanceCue {
  id: string;
  kind: PerformanceKind;
  label: string;
  wordOffset: number;
  pauseSeconds?: number;
}

export interface TimedPerformanceCue extends PerformanceCue {
  time: number;
  estimated: boolean;
}

const words = (value: string) =>
  value.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];

const kinds: [PerformanceKind, RegExp][] = [
  ["pause", /^(?:pause|beat|silence)\b/i],
  ["deadpan", /^(?:deadpan|dry|flat)\b/i],
  ["sarcastic", /^(?:sarcastic|sarcasm|mocking|ironic)\b/i],
  [
    "disbelief",
    /^(?:disbelief|disbelieving|in disbelief|incredulous|shocked)\b/i,
  ],
  [
    "frustrated",
    /^(?:frustrated|frustration|angry|furious|irritated|exasperated)\b/i,
  ],
  ["shouting", /^(?:shouting|shout|yelling|yell|screaming|loud)\b/i],
  ["whisper", /^(?:whisper|whispering|quietly|hushed)\b/i],
  [
    "escalating",
    /^(?:escalating|build|building|slow build|rising intensity)\b/i,
  ],
  ["emphasis", /^(?:emphasis|emphasize|stressed|stress)\b/i],
];

export function parsePerformanceScript(script: string): {
  dialogue: string;
  cues: PerformanceCue[];
} {
  const cues: PerformanceCue[] = [];
  const dialogueParts: string[] = [];
  const pattern = /\[([^\]\n]{1,80})\]|\(([^()\n]{1,80})\)/g;
  let cursor = 0;
  let wordOffset = 0;
  for (const match of script.matchAll(pattern)) {
    const position = match.index ?? 0;
    const before = script.slice(cursor, position);
    dialogueParts.push(before);
    wordOffset += words(before).length;
    const expression = match[1] ?? match[2];
    const fragments = expression.split(/[,;]/).map((value) => value.trim());
    const identified = fragments.map((fragment) => {
      const found = kinds.find(([, regex]) => regex.test(fragment));
      return found ? { fragment, kind: found[0] } : null;
    });
    // Unknown bracketed content is dialogue, not an instruction.
    if (!identified.length || identified.some((item) => !item)) {
      dialogueParts.push(match[0]);
      wordOffset += words(match[0]).length;
    } else {
      for (let i = 0; i < identified.length; i++) {
        const item = identified[i]!;
        const pause =
          item.kind === "pause"
            ? item.fragment.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)\b/i)
            : null;
        cues.push({
          id: `${position}:${i}:${item.kind}`,
          kind: item.kind,
          label: item.fragment,
          wordOffset,
          ...(pause ? { pauseSeconds: Math.min(10, Number(pause[1])) } : {}),
        });
      }
      // Preserve the word boundary on either side of a stage direction.
      dialogueParts.push(" ");
    }
    cursor = position + match[0].length;
  }
  dialogueParts.push(script.slice(cursor));
  return {
    dialogue: dialogueParts
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
    cues,
  };
}

export function timePerformanceCues(
  script: string,
  captions: CaptionCue[],
  duration: number,
  narrationStart = 0,
  overrides: Record<string, number> = {},
): TimedPerformanceCue[] {
  const parsed = parsePerformanceScript(script);
  const dialogueWords = words(parsed.dialogue);
  const availableDuration = Math.max(0, duration);
  const transcript = captions
    .filter(
      (cue) =>
        cue.end > narrationStart &&
        cue.start < narrationStart + availableDuration,
    )
    .flatMap((cue) => {
      const list = words(cue.text);
      return list.map((token, index) => ({
        token,
        time: Math.max(
          0,
          cue.start -
            narrationStart +
            ((cue.end - cue.start) * index) / Math.max(1, list.length),
        ),
      }));
    });
  const aligned = new Map<number, number>();
  let pointer = 0;
  dialogueWords.forEach((token, index) => {
    const candidate = transcript.findIndex(
      (item, at) => at >= pointer && at < pointer + 15 && item.token === token,
    );
    if (candidate >= 0) {
      aligned.set(index, transcript[candidate].time);
      pointer = candidate + 1;
    }
  });
  const usable =
    dialogueWords.length > 0 && aligned.size / dialogueWords.length >= 0.5;
  return parsed.cues.map((cue) => {
    const fallback = dialogueWords.length
      ? (availableDuration * cue.wordOffset) / dialogueWords.length
      : 0;
    let time = fallback;
    let estimated = true;
    if (usable) {
      for (
        let i = cue.wordOffset;
        i < Math.min(cue.wordOffset + 5, dialogueWords.length);
        i++
      ) {
        if (aligned.has(i)) {
          time = aligned.get(i)!;
          estimated = false;
          break;
        }
      }
      if (cue.wordOffset >= dialogueWords.length && transcript.length) {
        time = transcript[transcript.length - 1].time;
        estimated = false;
      }
    }
    if (Number.isFinite(overrides[cue.id])) {
      time = overrides[cue.id];
      estimated = false;
    }
    return {
      ...cue,
      time: Math.max(0, Math.min(availableDuration, time)),
      estimated,
    };
  });
}

export function applyPerformanceCues(
  scenes: Scene[],
  cues: TimedPerformanceCue[],
  fps: number,
): { scenes: Scene[]; changed: number } {
  const updated = scenes.map((scene) => ({ ...scene }));
  const used = new Set<number>();
  let changed = 0;
  for (const cue of [...cues].sort((a, b) => a.time - b.time)) {
    if (cue.kind === "pause" && (cue.pauseSeconds ?? 0) < 0.5) continue;
    let cursor = 0;
    const index = updated.findIndex((scene) => {
      const start = cursor;
      cursor += Math.round(scene.duration * fps) / fps;
      return cue.time >= start && cue.time < cursor;
    });
    if (index < 0 || used.has(index) || updated[index].locked) continue;
    const scene = updated[index];
    const visual = {
      disbelief: {
        motion: "punch_in",
        motion_strength: 0.16,
        easing: "ease_out",
      },
      frustrated: {
        motion: "zoom_in",
        motion_strength: 0.13,
        easing: "ease_out",
      },
      shouting: {
        motion: "punch_in",
        motion_strength: 0.18,
        easing: "ease_out",
      },
      sarcastic: { motion: "hold", motion_strength: 0.02, easing: "smooth" },
      deadpan: { motion: "hold", motion_strength: 0.02, easing: "smooth" },
      whisper: { motion: "zoom_in", motion_strength: 0.06, easing: "smooth" },
      escalating: {
        motion: "zoom_in",
        motion_strength: 0.12,
        easing: "ease_in",
      },
      pause: { motion: "hold", motion_strength: 0.02, easing: "smooth" },
      emphasis: {
        motion: "punch_in",
        motion_strength: 0.12,
        easing: "ease_out",
      },
    } as const;
    Object.assign(scene, visual[cue.kind]);
    used.add(index);
    changed++;
  }
  return { scenes: updated, changed };
}
