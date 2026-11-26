import styles from "./switch.module.css";

/** An on/off switch as drawn: a track with a knob. It is a real checkbox, so keys work. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What the switch turns on, for a reader that does not see the row it stands in. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className={styles.switch}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </span>
  );
}
