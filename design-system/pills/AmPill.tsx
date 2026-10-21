// AmPill: a small status label. Four tones, so meaning is consistent app-wide:
// positive = done or safe, caution = needs a look, negative = undone or wrong,
// neutral = just information.

import type { JSX, ReactNode } from "react";
import styles from "./AmPill.module.css";

export type AmPillTone = "neutral" | "positive" | "caution" | "negative";

export type AmPillProps = { children: ReactNode; tone?: AmPillTone; className?: string; title?: string };

export function AmPill({ children, tone = "neutral", className, title }: AmPillProps): JSX.Element {
  return (
    <span className={[styles.pill, styles[tone], className].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}
