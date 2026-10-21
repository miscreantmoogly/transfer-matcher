// A second, independent data generator used ONLY for held-out evaluation and
// benchmarks. The matcher's weights were tuned on scripts/generate.ts; this
// generator was written afterwards with different memo wording, a realistic
// lag distribution, non-round transfers, and round-number commerce that
// collides with transfer amounts. Its results were not used to tune anything.

import { addBusinessDays, businessDaysInRange } from "./dates";
import { BANK_ACCOUNTS, ENTITIES } from "./org";
import type { AccountInfo, EntityInfo, MatchTxn } from "./matcher/types";

export type StressCase = {
  transactions: MatchTxn[];
  accounts: AccountInfo[];
  entities: EntityInfo[];
  /** legsKey -> true transfer groups */
  truth: { outs: string[]; ins: string[]; kind: string }[];
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StressOptions = {
  seed: number;
  /** Roughly how many transactions to generate. */
  size: number;
  /** Share of transactions that are one side of a real transfer. */
  transferShare?: number;
  start?: string;
  end?: string;
};

export function generateStressCase(opts: StressOptions): StressCase {
  const rand = mulberry32(opts.seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const weighted = <T>(pairs: [T, number][]) => {
    let r = rand() * pairs.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
    return pairs[pairs.length - 1][0];
  };
  const days = businessDaysInRange(opts.start ?? "2026-04-01", opts.end ?? "2026-07-31");
  const accounts = BANK_ACCOUNTS.map((a) => ({ id: a.id, entityId: a.entityId, last4: a.last4 }));
  const entities = ENTITIES.map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
  const businessAccounts = BANK_ACCOUNTS.filter((a) => ENTITIES.find((e) => e.id === a.entityId)!.kind === "business");
  const personal = BANK_ACCOUNTS.find((a) => ENTITIES.find((e) => e.id === a.entityId)!.kind === "personal")!;
  const nameOf = (accountId: string) =>
    ENTITIES.find((e) => e.id === BANK_ACCOUNTS.find((a) => a.id === accountId)!.entityId)!.shortName;

  let n = 0;
  const txns: MatchTxn[] = [];
  const add = (accountId: string, postedDate: string, amountCents: number, memo: string) => {
    const id = `s${opts.seed}_${++n}`;
    txns.push({ id, accountId, postedDate, amountCents, memo });
    return id;
  };
  const truth: StressCase["truth"] = [];

  // Memo wording deliberately different from the tuning data.
  const ownOut = (to: { last4: string }) =>
    pick([
      `TRANSFER TO ACCT XXXXXX${to.last4}`,
      `INTERNAL TRANSFER TO ...${to.last4}`,
      `ONLINE BANKING TRANSFER TO ${to.last4}`,
      "BOOK TRANSFER DEBIT",
      "FUNDS TRANSFER",
      "WITHDRAWAL",
      "TRANSFER",
    ]);
  const ownIn = (from: { last4: string }) =>
    pick([
      `TRANSFER FROM ACCT XXXXXX${from.last4}`,
      `INTERNAL TRANSFER FROM ...${from.last4}`,
      `ONLINE BANKING TRANSFER FROM ${from.last4}`,
      "BOOK TRANSFER CREDIT",
      "FUNDS TRANSFER",
      "DEPOSIT",
      "TRANSFER",
    ]);
  const icOut = (toAccount: string) =>
    pick([`PAYMENT TO ${nameOf(toAccount)}`, `ACH ${nameOf(toAccount)}`, `${nameOf(toAccount)} TRANSFER`, "ACH DEBIT", "WITHDRAWAL"]);
  const icIn = (fromAccount: string) =>
    pick([`PAYMENT FROM ${nameOf(fromAccount)}`, `ACH CREDIT ${nameOf(fromAccount)}`, "ACH CREDIT", "DEPOSIT"]);

  const lag = () => weighted<number>([[0, 40], [1, 30], [2, 15], [3, 8], [4, 4], [5, 2], [7, 1]]);
  const amount = () =>
    rand() < 0.7 ? Math.round(1 + rand() * 60) * 50_000 / 1 /* $500 steps */ : Math.round(500_00 + rand() * 30_000_00);

  const transferCount = Math.round((opts.size * (opts.transferShare ?? 0.3)) / 2);
  for (let i = 0; i < transferCount; i++) {
    const from = pick(rand() < 0.1 ? [personal] : businessAccounts);
    const to = pick([...businessAccounts, personal].filter((a) => a.id !== from.id && !(from === personal && a === personal)));
    const sameEntity = from.entityId === to.entityId;
    const date = pick(days);
    const cents = amount();
    const l = lag();
    const outMemo = sameEntity ? ownOut(to) : icOut(to.id);
    const inMemo = sameEntity ? ownIn(from) : icIn(from.id);
    const split = rand() < 0.03 && cents >= 2_000_00;
    const fee = !split && rand() < 0.04 ? Math.round(10_00 + rand() * 25_00) : 0;
    const outId = add(from.id, date, -cents, outMemo);
    if (split) {
      const first = Math.round((cents * (0.3 + rand() * 0.4)) / 100) * 100;
      const second = pick(businessAccounts.filter((a) => a.id !== from.id && a.id !== to.id));
      const in1 = add(to.id, addBusinessDays(date, l), first, inMemo);
      const in2 = add(second.id, addBusinessDays(date, l), cents - first, inMemo);
      truth.push({ outs: [outId], ins: [in1, in2], kind: "split" });
    } else {
      const inId = add(to.id, addBusinessDays(date, l), cents - fee, fee ? `INCOMING WIRE ${nameOf(from.id)}` : inMemo);
      truth.push({ outs: [outId], ins: [inId], kind: sameEntity ? "same_entity" : from === personal || to === personal ? "owner" : "intercompany" });
    }
  }

  // Ordinary activity, including round-number commerce that collides with transfer amounts.
  const vendorsOut = [
    ["HIGH PLAINS FEED CO", 0.2],
    ["CO-OP FUEL STOP", 0.2],
    ["VALLEY VET CLINIC", 0.08],
    ["LAND RENT - JOHNSON FAMILY", 0.06], // round, recurring, not ours
    ["JOHN DEERE FINANCIAL LOAN PMT", 0.06], // round
    ["CUSTOM HARVEST - SMITH", 0.04], // round
    ["ZELLE TO J MARTINEZ", 0.05], // "transfer"-ish, external
    ["ONLINE TRANSFER TO CHK ...9921", 0.03], // to an unconnected account
    ["PAYROLL - RANCH HANDS", 0.08],
  ] as const;
  const vendorsIn = [
    ["SALE BARN PROCEEDS", 0.12],
    ["CROP INSURANCE INDEMNITY", 0.03], // round
    ["HAY SALE DEPOSIT", 0.06],
    ["DEPOSIT", 0.06], // a customer's check: bland, round
    ["ZELLE FROM K NGUYEN", 0.03],
  ] as const;
  const noiseCount = opts.size - txns.length;
  for (let i = 0; i < noiseCount; i++) {
    const outgoing = rand() < 0.75;
    const [memo] = weighted((outgoing ? vendorsOut : vendorsIn).map((v) => [v, v[1]] as [readonly [string, number], number]));
    const roundish = /RENT|LOAN|HARVEST|INDEMNITY|^DEPOSIT$|ZELLE|9921/.test(memo) || rand() < 0.15;
    const cents = roundish ? Math.round(2 + rand() * 40) * 50_000 : Math.round(40_00 + rand() * 6_000_00);
    add(pick(rand() < 0.9 ? businessAccounts : [personal]).id, pick(days), outgoing ? -cents : cents, memo);
  }

  return { transactions: txns, accounts, entities, truth };
}
