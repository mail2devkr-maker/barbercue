"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./landing.module.css";

interface Slide {
  title: string;
  text: string;
  icon: React.ReactNode;
}

const AUTOPLAY_MS = 6000;

// Illustrated, not photographic — no licensed media exists for this project yet (see
// ARCHITECTURE.md's media policy note), so each slide is a small inline SVG icon rather than a
// stock photo or a fabricated image URL. Swapping in real photography later only means replacing
// the `icon` node per slide, the carousel mechanics don't change.
const SLIDES: Slide[] = [
  {
    title: "Book your chair in seconds",
    text: "Pick a shop, a service, and a time — no phone call, no app install.",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="10" y="14" width="44" height="36" rx="4" stroke="currentColor" strokeWidth="2.5" />
        <path d="M10 24H54" stroke="currentColor" strokeWidth="2.5" />
        <path d="M20 10V18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M44 10V18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M22 34L29 41L43 27" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Skip the waiting room",
    text: "Join the live queue remotely and watch your position update in real time.",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="2.5" />
        <path d="M32 20V32L41 38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Try a new look with AI",
    text: "See yourself in a new hairstyle before you sit in the chair.",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="32" cy="26" r="12" stroke="currentColor" strokeWidth="2.5" />
        <path d="M14 52C14 43 22 38 32 38C42 38 50 43 50 52" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M44 14L47 20L53 22L47 24L44 30L41 24L35 22L41 20L44 14Z" fill="currentColor" />
      </svg>
    ),
  },
];

// Accessible carousel: prev/next buttons, dot indicators, keyboard arrows, autoplay that pauses
// on hover/focus and never runs at all under prefers-reduced-motion, aria-live announcing the
// active slide. No images to lazy-load (see the icon note above), so "optimized" here means: no
// network requests at all for the visual content.
export function HeroSlideshow() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [paused]);

  function go(delta: number) {
    setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  }

  return (
    <div
      ref={containerRef}
      className={styles.slideshow}
      role="region"
      aria-roledescription="carousel"
      aria-label="BarberCue features"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={handleKeyDown}
    >
      {SLIDES.map((slide, i) => (
        <div
          key={slide.title}
          className={`${styles.slide} ${i === index ? styles.slideActive : ""}`}
          aria-hidden={i !== index}
          aria-live={i === index ? "polite" : undefined}
        >
          <div className={styles.slideIcon}>{slide.icon}</div>
          <p className={styles.slideTitle}>{slide.title}</p>
          <p className={styles.slideText}>{slide.text}</p>
        </div>
      ))}

      <button
        type="button"
        className={`${styles.slideArrow} ${styles.slideArrowPrev}`}
        onClick={() => go(-1)}
        aria-label="Previous slide"
      >
        ‹
      </button>
      <button
        type="button"
        className={`${styles.slideArrow} ${styles.slideArrowNext}`}
        onClick={() => go(1)}
        aria-label="Next slide"
      >
        ›
      </button>

      <div className={styles.slideControls}>
        {SLIDES.map((slide, i) => (
          <button
            key={slide.title}
            type="button"
            className={`${styles.slideDot} ${i === index ? styles.slideDotActive : ""}`}
            aria-label={`Go to slide ${i + 1}: ${slide.title}`}
            aria-current={i === index}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
