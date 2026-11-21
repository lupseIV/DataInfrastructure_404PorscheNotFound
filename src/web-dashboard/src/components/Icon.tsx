interface IconProps {
  /** Material Symbols name, e.g. "battery_full". */
  name: string;
  className?: string;
}

export function Icon({ name, className = "" }: IconProps) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}
