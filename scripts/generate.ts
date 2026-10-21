// Generates a deterministic, synthetic bank feed for the demo organization,
// plus the ground truth (which transactions really are transfers) so the
// matcher can be scored with precision / recall.
//
//   npm run generate   ->  data/bank_feed.json, data/ground_truth.json
//
// Background activity (feed, fuel, vet bills, cattle sales...) is random but
// seeded, so every run produces the identical file. Transfers and traps are
// scripted by hand: each one exists to exercise a specific edge case.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BANK_ACCOUNTS, ENTITIES } from "../lib/org";
import { addBusinessDays, businessDaysInRange, isWeekend, parseDate } from "../lib/dates";

export type FeedTransaction = {
  providerTxnId: string;
  accountId: string;
  postedDate: string;
  amountCents: number; // negative = money out
  memo: string;
  batch: 1 | 2; // batch 2 = "the next bank sync", imported later in the demo
};

export type TruthGroup = {
  id: string;
  kind: "same_entity" | "intercompany";
  difficulty: "easy" | "medium" | "hard";
  label: string;
  outs: string[]; // providerTxnIds
  ins: string[];
};

export type Trap = { id: string; label: string; txns: string[] };

const SEED = 2027;
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-09-30";
const BATCH_2_AFTER = "2026-09-25"; // anything posted after this arrives in the second sync

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32): tiny, fast, and deterministic.
// ---------------------------------------------------------------------------
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
const rand = mulberry32(SEED);
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
/** Random dollar amount with non-zero cents, so it can't collide with round transfer amounts. */
const randCents = (minDollars: number, maxDollars: number) => randInt(minDollars, maxDollars) * 100 + randInt(1, 99);

let idCounter = 0;
function newId(): string {
  idCounter++;
  const suffix = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");
  return `ptx_${idCounter.toString().padStart(4, "0")}${suffix}`;
}

const transactions: FeedTransaction[] = [];
function add(accountId: string, postedDate: string, amountCents: number, memo: string): string {
  if (isWeekend(parseDate(postedDate))) throw new Error(`${postedDate} is a weekend (${memo})`);
  const providerTxnId = newId();
  transactions.push({
    providerTxnId,
    accountId,
    postedDate,
    amountCents,
    memo,
    batch: postedDate > BATCH_2_AFTER ? 2 : 1,
  });
  return providerTxnId;
}

// ---------------------------------------------------------------------------
// Memo helpers: what real bank memos look like
// ---------------------------------------------------------------------------
const acct = (id: string) => {
  const a = BANK_ACCOUNTS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown account ${id}`);
  return a;
};
const typeCode = (id: string) => (id.endsWith("sav") ? "SAV" : "CHK");
const entityShort = (accountId: string) => ENTITIES.find((e) => e.id === acct(accountId).entityId)!.shortName;

const memo = {
  onlineTo: (to: string) => `ONLINE TRANSFER TO ${typeCode(to)} ...${acct(to).last4}`,
  onlineFrom: (from: string) => `ONLINE TRANSFER FROM ${typeCode(from)} ...${acct(from).last4}`,
  autoTo: (to: string) => `AUTO TRANSFER TO ${typeCode(to)} ...${acct(to).last4}`,
  autoFrom: (from: string) => `AUTO TRANSFER FROM ${typeCode(from)} ...${acct(from).last4}`,
  entityTo: (to: string) => `TRANSFER TO ${entityShort(to)}`,
  entityFrom: (from: string) => `TRANSFER FROM ${entityShort(from)}`,
};

// ---------------------------------------------------------------------------
// 1. Background activity: ordinary income and expenses
// ---------------------------------------------------------------------------
type Vendor = { memo: () => string; min: number; max: number; p: number };
const EXPENSES: Vendor[] = [
  { memo: () => `HIGH PLAINS FEED CO INV ${randInt(1000, 9999)}`, min: 400, max: 6000, p: 0.22 },
  { memo: () => `CO-OP FUEL STOP #114`, min: 80, max: 900, p: 0.25 },
  { memo: () => `VALLEY VET CLINIC`, min: 60, max: 1500, p: 0.1 },
  { memo: () => `WESTERN EQUIP CO PARTS`, min: 200, max: 4000, p: 0.08 },
  { memo: () => `PRAIRIE PROPANE`, min: 150, max: 700, p: 0.05 },
];
const INCOME: Vendor[] = [
  { memo: () => `SALE BARN PROCEEDS LOT ${randInt(10, 99)}`, min: 8000, max: 60000, p: 0.05 },
  { memo: () => `HAY SALE DEPOSIT`, min: 500, max: 4000, p: 0.04 },
  { memo: () => `USDA FSA PMT`, min: 1000, max: 9000, p: 0.01 },
];

const days = businessDaysInRange(PERIOD_START, PERIOD_END);
for (const accountId of ["cedar-chk", "hollis-chk"]) {
  const scale = accountId === "cedar-chk" ? 1 : 0.75; // Hollis is the smaller operation
  for (const day of days) {
    for (const v of EXPENSES) if (rand() < v.p * scale) add(accountId, day, -randCents(v.min, v.max), v.memo());
    for (const v of INCOME) if (rand() < v.p * scale) add(accountId, day, randCents(v.min, v.max), v.memo());
  }
  // Biweekly payroll on alternating Thursdays.
  for (const day of days.filter((d) => parseDate(d).getUTCDay() === 4).filter((_, i) => i % 2 === 0)) {
    add(accountId, day, -randCents(2800, 4200), "PAYROLL - RANCH HANDS");
  }
}
// Savings accounts: monthly interest on the last business day of the month.
for (const accountId of ["cedar-sav", "hollis-sav"]) {
  for (const monthEnd of ["2026-07-31", "2026-08-31", "2026-09-30"]) {
    add(accountId, monthEnd, randCents(8, 60), "INTEREST PAYMENT");
  }
}

// ---------------------------------------------------------------------------
// 2. Real transfers (ground truth)
// ---------------------------------------------------------------------------
const groups: TruthGroup[] = [];
const traps: Trap[] = [];
const kindOf = (from: string, to: string) =>
  acct(from).entityId === acct(to).entityId ? ("same_entity" as const) : ("intercompany" as const);

/** A simple 1-to-1 transfer. `lag` = business days between withdrawal and deposit (can be negative). */
function transfer(opts: {
  from: string;
  to: string;
  dollars: number;
  outDate: string;
  lag: number;
  outMemo: string;
  inMemo: string;
  difficulty: TruthGroup["difficulty"];
  label: string;
  inDollars?: number; // when a fee was deducted in flight
}) {
  const outId = add(opts.from, opts.outDate, -opts.dollars * 100, opts.outMemo);
  const inId = add(opts.to, addBusinessDays(opts.outDate, opts.lag), Math.round((opts.inDollars ?? opts.dollars) * 100), opts.inMemo);
  groups.push({
    id: `T${groups.length + 1}`,
    kind: kindOf(opts.from, opts.to),
    difficulty: opts.difficulty,
    label: opts.label,
    outs: [outId],
    ins: [inId],
  });
}

// --- Easy: clear memos, short lag ------------------------------------------
const easy = (from: string, to: string, dollars: number, outDate: string, lag: number, label: string) =>
  transfer({
    from, to, dollars, outDate, lag, label, difficulty: "easy",
    outMemo: kindOf(from, to) === "intercompany" ? memo.entityTo(to) : memo.onlineTo(to),
    inMemo: kindOf(from, to) === "intercompany" ? memo.entityFrom(from) : memo.onlineFrom(from),
  });

easy("cedar-chk", "cedar-sav", 15000, "2026-07-02", 0, "Sweep to reserve savings");
easy("hollis-chk", "hollis-sav", 8000, "2026-07-09", 1, "Fund equipment savings");
easy("cedar-chk", "hollis-chk", 40000, "2026-07-14", 1, "Son lends father's ranch operating cash");
easy("hollis-chk", "cedar-chk", 22000, "2026-07-28", 2, "Partial repayment to Cedar");
easy("cedar-sav", "cedar-chk", 30000, "2026-08-04", 0, "Pull from reserves for cattle purchase");
easy("hollis-sav", "hollis-chk", 6000, "2026-08-19", 0, "Pull from equipment savings");
easy("cedar-chk", "hollis-chk", 27000, "2026-09-02", 1, "Intercompany loan");
easy("hollis-chk", "cedar-sav", 9000, "2026-09-09", 2, "Repayment into Cedar savings");
easy("cedar-chk", "cedar-sav", 12000, "2026-09-16", 1, "Sweep to reserve savings");
easy("cedar-sav", "cedar-chk", 5000, "2026-07-30", 0, "Small top-up (same day as a $5,000 feed bill at Hollis)");

// Intercompany, but the memo only has the account's last 4 digits, no name.
transfer({
  from: "cedar-chk", to: "hollis-chk", dollars: 18500, outDate: "2026-08-11", lag: 1, difficulty: "easy",
  outMemo: memo.onlineTo("hollis-chk"), inMemo: memo.onlineFrom("cedar-chk"),
  label: "Intercompany transfer identified only by last-4 digits",
});

// Recurring biweekly auto-save: high volume, trivially easy.
for (const friday of ["2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25"]) {
  transfer({
    from: "cedar-chk", to: "cedar-sav", dollars: 1500, outDate: friday, lag: 0, difficulty: "easy",
    outMemo: memo.autoTo("cedar-sav"), inMemo: memo.autoFrom("cedar-chk"), label: "Recurring auto-save",
  });
}

// --- Medium: bland memos ("WITHDRAWAL" / "DEPOSIT") -------------------------
transfer({
  from: "cedar-chk", to: "hollis-chk", dollars: 12500, outDate: "2026-07-21", lag: 1, difficulty: "medium",
  outMemo: "WITHDRAWAL", inMemo: "DEPOSIT", label: "Bland memos, with a same-amount cattle sale as a decoy",
});
transfer({
  from: "hollis-sav", to: "hollis-chk", dollars: 4000, outDate: "2026-08-25", lag: 2, difficulty: "medium",
  outMemo: "WITHDRAWAL", inMemo: "DEPOSIT", label: "Bland memos, 2-day lag",
});
transfer({
  from: "cedar-sav", to: "hollis-chk", dollars: 7500, outDate: "2026-09-14", lag: 3, difficulty: "medium",
  outMemo: "WITHDRAWAL", inMemo: "COUNTER DEPOSIT", label: "Bland memos, 3-day lag",
});
transfer({
  from: "cedar-sav", to: "cedar-chk", dollars: 10000, outDate: "2026-08-13", lag: -1, difficulty: "medium",
  outMemo: memo.onlineTo("cedar-chk"), inMemo: memo.onlineFrom("cedar-sav"),
  label: "Deposit posted a day BEFORE the withdrawal (banks post on different schedules)",
});

// --- Hard -------------------------------------------------------------------
transfer({
  from: "hollis-chk", to: "cedar-chk", dollars: 16000, outDate: "2026-07-07", lag: 4, difficulty: "hard",
  outMemo: memo.entityTo("cedar-chk"), inMemo: memo.entityFrom("hollis-chk"), label: "Slow ACH: 4 business days",
});
transfer({
  from: "cedar-chk", to: "hollis-sav", dollars: 5500, outDate: "2026-08-06", lag: 5, difficulty: "hard",
  outMemo: "ACH DEBIT HOLLIS RANCH", inMemo: "ACH CREDIT CEDAR CREEK CATTLE", label: "Slow ACH: 5 business days",
});
transfer({
  from: "cedar-chk", to: "hollis-chk", dollars: 75000, inDollars: 74985, outDate: "2026-07-23", lag: 0, difficulty: "hard",
  outMemo: "WIRE TRANSFER OUT HOLLIS RANCH LLC REF 88412", inMemo: "INCOMING WIRE CEDAR CREEK CATTLE CO REF 88412",
  label: "Wire: receiving bank deducted a $15 fee, so amounts differ",
});
transfer({
  from: "cedar-chk", to: "hollis-chk", dollars: 2350, outDate: "2026-09-03", lag: 3, difficulty: "hard",
  outMemo: "CHECK #1042", inMemo: "MOBILE DEPOSIT", label: "Paper check between entities: no transfer wording at all",
});

// Two identical $2,500 transfers two days apart. The globally-best pairing
// matches each withdrawal to its own deposit; picking the single closest pair
// first (greedy) steals the middle deposit and can orphan the other two.
for (const [outDate, label] of [["2026-08-17", "Identical same-week transfer #1 (greedy trap)"], ["2026-08-19", "Identical same-week transfer #2 (greedy trap)"]]) {
  transfer({
    from: "cedar-sav", to: "hollis-sav", dollars: 2500, outDate, lag: 2, difficulty: "hard",
    outMemo: "WITHDRAWAL", inMemo: "DEPOSIT", label,
  });
}

// One withdrawal, two deposits (split across two of Hollis's accounts).
{
  const out = add("cedar-chk", "2026-07-16", -5_000_000, memo.entityTo("hollis-chk"));
  const in1 = add("hollis-chk", "2026-07-17", 3_000_000, memo.entityFrom("cedar-chk"));
  const in2 = add("hollis-sav", "2026-07-17", 2_000_000, memo.entityFrom("cedar-chk"));
  groups.push({ id: `T${groups.length + 1}`, kind: "intercompany", difficulty: "hard", label: "Split: $50K out, lands as $30K + $20K", outs: [out], ins: [in1, in2] });
}
// Two withdrawals, one deposit.
{
  const out1 = add("cedar-chk", "2026-08-26", -900_000, memo.entityTo("hollis-chk"));
  const out2 = add("cedar-sav", "2026-08-26", -600_000, memo.entityTo("hollis-chk"));
  const in1 = add("hollis-chk", "2026-08-27", 1_500_000, memo.entityFrom("cedar-chk"));
  groups.push({ id: `T${groups.length + 1}`, kind: "intercompany", difficulty: "hard", label: "Merge: $9K + $6K out, lands as one $15K deposit", outs: [out1, out2], ins: [in1] });
}

// Sent before the first sync, but the deposit only shows up in the second one.
transfer({
  from: "hollis-chk", to: "cedar-chk", dollars: 11000, outDate: "2026-09-24", lag: 2, difficulty: "medium",
  outMemo: memo.entityTo("cedar-chk"), inMemo: memo.entityFrom("hollis-chk"),
  label: "Counterpart arrives in the NEXT bank sync",
});
easy("cedar-chk", "cedar-sav", 3000, "2026-09-29", 0, "Transfer entirely within the second sync");

// ---------------------------------------------------------------------------
// 3. Traps: things that look like transfers but are not
// ---------------------------------------------------------------------------
traps.push({
  id: "X1", label: "Transfer to an account Ambrook can't see (no counterpart exists)",
  txns: [add("cedar-chk", "2026-08-20", -1_000_000, "ONLINE TRANSFER TO CHK ...9912")],
});
traps.push({
  id: "X2", label: "Transfer that bounced back into the same account",
  txns: [
    add("hollis-chk", "2026-09-17", -800_000, memo.onlineTo("hollis-sav")),
    add("hollis-chk", "2026-09-18", 800_000, "RETURNED TRANSFER ...3307"),
  ],
});
traps.push({
  id: "X3", label: "$5,000 feed bill at Hollis on the same day as Cedar's $5,000 savings top-up",
  txns: [add("hollis-chk", "2026-07-30", -500_000, "HIGH PLAINS FEED CO INV 7781")],
});
traps.push({
  id: "X4", label: "$12,500 cattle sale at Hollis savings, same day as the bland $12,500 transfer",
  txns: [add("hollis-sav", "2026-07-21", 1_250_000, "SALE BARN PROCEEDS LOT 22")],
});
traps.push({
  id: "X5", label: "Payment to a trucker that says 'TRANSFER', next to an unrelated same-amount hay sale",
  txns: [
    add("hollis-chk", "2026-09-21", -320_000, "ONLINE TRANSFER TO J HAULING LLC"),
    add("cedar-sav", "2026-09-22", 320_000, "HAY SALE DEPOSIT"),
  ],
});

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------
transactions.sort((a, b) => a.postedDate.localeCompare(b.postedDate) || a.providerTxnId.localeCompare(b.providerTxnId));

const outDir = join(__dirname, "..", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "bank_feed.json"),
  JSON.stringify({ seed: SEED, period: [PERIOD_START, PERIOD_END], transactions }, null, 2) + "\n",
);
writeFileSync(join(outDir, "ground_truth.json"), JSON.stringify({ groups, traps }, null, 2) + "\n");

const batch2 = transactions.filter((t) => t.batch === 2).length;
console.log(
  `Wrote ${transactions.length} transactions (${transactions.length - batch2} in sync 1, ${batch2} in sync 2), ` +
    `${groups.length} true transfers, ${traps.length} traps.`,
);
