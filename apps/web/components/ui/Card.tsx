import styles from "./card.module.css";

// One consistent card language for the new customer-experience surfaces — warm white, subtle
// border, modest radius. `raised` adds a restrained shadow for the single most prominent card on
// a page (e.g. the upcoming-booking card); the flat default suits everything else.
export function Card({
  raised,
  className,
  children,
}: {
  raised?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = [styles.card, raised ? styles.raised : "", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}
