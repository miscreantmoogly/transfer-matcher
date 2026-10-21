// AmCheckList: a list of pass / fail / warning lines with an optional action.
//
// One component for three places that are really the same idea: the reasons
// behind a match, the pre-flight checks before accepting, and the "ready to
// share" checks on the consolidated report.

import type { JSX, ReactNode } from "react";
import styles from "./AmCheckList.module.css";

export type AmCheckState = "pass" | "fail" | "warn";

export type AmCheckItem = {
  key: string;
  label: ReactNode;
  state: AmCheckState;
  /** Shown under the label, only when the check didn't pass. */
  detail?: ReactNode;
  /** e.g. a link to where the problem gets fixed. */
  action?: ReactNode;
};

const MARK: Record<AmCheckState, string> = { pass: "✓", fail: "✗", warn: "!" };
const SPOKEN: Record<AmCheckState, string> = { pass: "Passed", fail: "Failed", warn: "Warning" };

export function AmCheckList({ items }: { items: AmCheckItem[] }): JSX.Element {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.key} className={styles.item}>
          <span className={`${styles.mark} ${styles[item.state]}`} aria-label={SPOKEN[item.state]} role="img">
            {MARK[item.state]}
          </span>
          <span className={styles.label}>
            {item.label}
            {item.state !== "pass" && item.detail && <span className={styles.detail}>{item.detail}</span>}
          </span>
          {item.action}
        </li>
      ))}
    </ul>
  );
}
