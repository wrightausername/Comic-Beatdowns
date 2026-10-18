import { CAMERA_MOVES, TRANSITIONS } from "./effects";

function GroupedOptions({
  options,
}: {
  options: readonly { value: string; label: string; group: string }[];
}) {
  return (
    <>
      {[...new Set(options.map((o) => o.group))].map((group) => (
        <optgroup key={group} label={group}>
          {options
            .filter((o) => o.group === group)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
export function MotionOptions() {
  return <GroupedOptions options={CAMERA_MOVES} />;
}
export function TransitionOptions() {
  return <GroupedOptions options={TRANSITIONS} />;
}
export function EasingOptions() {
  return (
    <>
      <option value="smooth">Smooth start & stop</option>
      <option value="linear">Steady speed</option>
      <option value="ease_in">Build speed</option>
      <option value="ease_out">Settle gently</option>
    </>
  );
}
