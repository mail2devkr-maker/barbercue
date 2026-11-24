"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./theme-switcher.module.css";

/**
 * Owner request: Light / Dark theme on the website. The choice is saved in this browser
 * (localStorage "fq-theme") and applied as <html data-theme>. "As designed" removes the attribute,
 * so every colour falls back to exactly today's design (see app/theme-vars.css).
 */
export type WebThemeChoice = "designed" | "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "fq-theme";

const OPTIONS: Array<{ id: WebThemeChoice; label: string }> = [
  { id: "designed", label: "As designed" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Same as device" },
];

export function resolveWebTheme(choice: WebThemeChoice, prefersDark: boolean): "light" | "dark" | null {
  if (choice === "designed") return null;
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

export function applyWebTheme(choice: WebThemeChoice) {
  const prefersDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveWebTheme(choice, prefersDark);
  if (resolved) document.documentElement.setAttribute("data-theme", resolved);
  else document.documentElement.removeAttribute("data-theme");
}

function readChoice(): WebThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return OPTIONS.some((o) => o.id === saved) ? (saved as WebThemeChoice) : "designed";
  } catch {
    return "designed";
  }
}

export function ThemeSwitcher() {
  const [choice, setChoice] = useState<WebThemeChoice>("designed");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape: the menu now drops over page content.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const saved = readChoice();
    setChoice(saved);
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readChoice() === "system") applyWebTheme("system");
    };
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  function pick(next: WebThemeChoice) {
    setChoice(next);
    setOpen(false);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode: still apply for this page */
    }
    applyWebTheme(next);
  }

  return (
    <div className={styles.root} ref={rootRef}>
      {open && (
        <div className={styles.menu} role="radiogroup" aria-label="Appearance">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={choice === o.id}
              className={`${styles.option} ${choice === o.id ? styles.optionOn : ""}`}
              onClick={() => pick(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-label="Appearance: light or dark theme"
        title="Theme"
        onClick={() => {
          setChoice(readChoice());
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden="true">◐</span>
      </button>
    </div>
  );
}

/** Runs before first paint (inline in <head>) so a saved theme never flashes the designed colours. */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem('${THEME_STORAGE_KEY}');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var r=c==='light'||c==='dark'?c:c==='system'?(d?'dark':'light'):null;if(r)document.documentElement.setAttribute('data-theme',r);}catch(e){}})();`;
