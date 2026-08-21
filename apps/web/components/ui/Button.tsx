import Link from "next/link";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "outline";

function classesFor(variant: ButtonVariant = "primary", fullWidth?: boolean, className?: string): string {
  return [styles.button, styles[variant], fullWidth ? styles.fullWidth : "", className]
    .filter(Boolean)
    .join(" ");
}

// Real <button> — for in-page actions (submit, logout, toggle), not navigation.
export function Button({
  variant,
  fullWidth,
  className,
  ...rest
}: {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={classesFor(variant, fullWidth, className)} {...rest} />;
}

// Same visual language as Button, but an actual <Link> — for navigational CTAs (e.g. "Find a
// Barber" -> /search) so routing stays real Next.js navigation, not a button with an onClick router push.
export function LinkButton({
  variant,
  fullWidth,
  className,
  href,
  ...rest
}: {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
  href: string;
} & Omit<React.ComponentProps<typeof Link>, "className" | "href">) {
  return <Link href={href} className={classesFor(variant, fullWidth, className)} {...rest} />;
}
