import styles from "./card.module.css";

// One consistent card language for the new customer-experience surfaces — warm white, subtle
// border, modest radius. `raised` adds a restrained shadow for the single most prominent card on
// a page (e.g. the upcoming-booking card); the flat default suits everything else. `interactive`
// adds a hover lift and border darken — only for a card that is itself a click target (wraps a
// link, or has its own onClick), never a purely informational one.
export function Card({
  raised,
  interactive,
  className,
  style,
  children,
}: {
  raised?: boolean;
  interactive?: boolean;
  className?: string;
  /** Escape hatch for one-off layout (margin, etc.) — never for anything the card's own styling should own. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const classes = [styles.card, raised ? styles.raised : "", interactive ? styles.interactive : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}
