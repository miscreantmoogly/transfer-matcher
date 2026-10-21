// AmMoney: every amount on screen. Takes integer cents (the backend's Cents
// type) and one of three formats, so the same number never looks different
// on two screens.

import type { JSX } from "react";
import type { Cents } from "@/lib/domain";
import { formatAccounting, formatMoney, formatMoneyWhole } from "../format";
import styles from "./AmMoney.module.css";

export type AmMoneyProps = {
  cents: Cents;
  /** exact: $1,234.56 (bank lines). whole: $1,235 (summaries). accounting: 1,235 / (1,235) / — (statements). */
  format?: "exact" | "whole" | "accounting";
  /** Show + or − in front (bank lines: money in vs. money out). */
  signed?: boolean;
  /** Bold money coming in, like a bank statement. */
  emphasizeIn?: boolean;
};

export function AmMoney({ cents, format = "exact", signed = false, emphasizeIn = false }: AmMoneyProps): JSX.Element {
  const text =
    format === "accounting"
      ? formatAccounting(cents)
      : (signed ? (cents > 0 ? "+" : cents < 0 ? "−" : "") : cents < 0 ? "−" : "") +
        (format === "whole" ? formatMoneyWhole(Math.abs(cents)) : formatMoney(Math.abs(cents)));
  const cls = [styles.money, emphasizeIn && cents > 0 && styles.in].filter(Boolean).join(" ");
  return <span className={cls}>{text}</span>;
}
