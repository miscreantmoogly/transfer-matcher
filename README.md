# Transfer Matcher

Finds the money a business owner moved between their **own** bank accounts and
legal entities, proposes matches for a human to review, and books the accepted
ones as balanced journal entries, so transfers stop showing up as income and
expenses. Then it does what that makes possible: **consolidated statements** for
the family's businesses, with everything they did with each other eliminated,
and a check that says whether the numbers are ready to hand to a lender.

![Review queue in the paired (T-chart) view](docs/screenshot-review.png)

## The problem

A rancher moves $40,000 from her operating account to her father's ranch, which
she also keeps the books for. The bank feed shows two unrelated lines:

```
Cedar Creek Cattle Co.  Operating Checking   Jul 14   -$40,000.00   TRANSFER TO HOLLIS RANCH
Hollis Ranch LLC        Operating Checking   Jul 15   +$40,000.00   TRANSFER FROM CEDAR CREEK CATTLE
```

A typical bank import books the withdrawal as an expense and the deposit as
income. Until someone pairs them by hand, Hollis Ranch looks $40,000 more
profitable than it is, Cedar Creek looks $40,000 less, and neither set of books
records that one business now owes the other. Those books feed tax returns and
the reports lenders use to set credit lines.

The demo organization is a fictional family operation with four connected
"entities": **Cedar Creek Cattle Co.** (Wes), **Hollis Ranch LLC** (his father;
Wes keeps its books), **Hollis Land Co.** (holds the land and leases pasture to
both ranches), and **Wes's personal checking**. Money moves between them in
different ways, and each needs different accounting:

| Movement | Example | Correct treatment |
|---|---|---|
| Between one business's own accounts | checking to savings | Neither income nor expense |
| Between two businesses | Cedar lends Hollis Ranch $40,000 | Due from / due to (intercompany loan) |
| Business to owner | Wes's monthly $3,500 draw | Owner's draw (equity), not an expense |
| Owner to business | Wes puts $7,000 into Hollis Ranch | Owner contribution (equity), not income |
| Real business between the entities | pasture rent to Hollis Land, a hay sale | **Not a transfer**: real income and expense on each business's books; eliminated only when they're reported together |

Pairing transfers sounds trivial (same amount, opposite sign) but real feeds
make it hard:

| What happens in real bank feeds | Example in the demo data |
|---|---|
| The two sides post days apart (ACH), or the deposit posts first | 0 to 5 business days apart; one deposit a day *before* its withdrawal |
| Memos are vague | `WITHDRAWAL` / `DEPOSIT` |
| Same-amount coincidences | a $5,000 feed bill on the same day as a $5,000 transfer |
| A fee is deducted in flight | $75,000 wire arrives as $74,985 |
| One transfer lands in several accounts | $50,000 out arrives as $30,000 + $20,000 |
| No transfer wording at all | a paper check written from one entity to the other |
| The other side never arrives (yet) | the deposit shows up in the *next* bank sync |
| The same money passes through several entities | Cedar to Hollis Ranch to Hollis Land, $20,000 each, same day |
| Money between related entities that is real income | monthly pasture rent, a hay sale between the ranches |

## Quick start

Requires Node 20+.

```bash
git clone https://github.com/miscreantmoogly/transfer-matcher.git
cd transfer-matcher
npm install
npm run seed       # creates data/app.db (SQLite, no server needed)
npm run dev        # http://localhost:3000
npm run worker     # in a second terminal: the background matcher
```

Click **Sync bank** to import the first batch of bank activity. If the worker
isn't running, the app notices and offers to run matching inline.

Other commands:

```bash
npm test           # 59 tests: matcher unit tests + service integration tests on real SQLite
npm run eval       # precision / recall against ground truth -> data/eval_report.md
npm run heldout    # held-out evaluation on an independent generator -> data/heldout_report.md
npm run bench      # 8,000-customer fleet, large customers, worst case -> data/bench_report.md
npm run generate   # regenerate the synthetic bank feed (deterministic, seeded)
npm run seed -- --synced   # start with sync 1 already imported and matched
```

## The review screen

- **Paired view (default):** a T-chart. Money out on the left, money in on the
  right, amounts meeting at the center line so they can be compared without
  reading. Text in a memo that points at the other side (an account's last 4
  digits, the other business's name, a shared wire reference) is highlighted,
  so the evidence is visible, not just a score. A **List** view is one click away
  for scanning many rows.
- **Bulk actions:** checkboxes and select-all, then accept or reject. Each item
  is its own database transaction, so one stale item doesn't block the rest.
- **Detail drawer:** both bank lines, every reason behind the score, and what
  accepting does to the books in plain words. It pushes the page over instead
  of covering it, so both sides of the T stay visible.
- **Part of a larger app:** Transfers sits in a full bookkeeping sidebar (other
  sections are placeholders) with Review, Unmatched and History, Consolidated
  statements, a Transfer
  impact report, and an internal **Matcher diagnostics** page that grades the
  matcher case by case against the answer key.
- **Working through a queue:** accepting moves straight to the next match;
  `J`/`K` move, `A` accepts, `X` selects. Every accept offers **Undo**.

## Design system

Built the way Ambrook describes in
[How Engineers Design: Full-Stack Design Systems](https://ambrook.com/engineering/design-systems/how-engineers-design-full-stack-design-systems-at-ambrook):
components are written once and used everywhere, and types are shared across the stack.

- **`Am`-prefixed components in `design-system/`**, grouped by type:
  `AmButton`, `AmPill`, `AmMoney`, `AmCheckList`, plus `AmTierPill`,
  `AmStatusPill` and `AmKindPill` for backend values. App screens use only these.
  Nothing else styles a button or a pill.
- **Logic and presentation in separate files.** Behavior lives in
  `AmButton.tsx`; presentation lives in `AmButton.module.css` beside it.
  `AmButton` handles `href`, `onClick`, both, or neither, so every button looks
  the same whatever it does. (Ambrook uses styled-components; CSS Modules give
  the same split with no new dependency.)
- **One color module.** `design-system/colors.ts` holds palettes indexed by
  name and shade (`Colors.sage[60]`) and the semantic tokens components use. The
  root layout turns them into CSS variables, so the stylesheet has no hex values.
- **Full-stack types.** `lib/domain.ts` lists every match status, tier and kind.
  The services and the components both use these types. `AmStatusPill` maps over
  `Record<ProposalStatus, ...>`, so adding a status without a label fails the
  build. A test reads `db/schema.sql` and fails if the database's CHECK
  constraints drift from these lists.
- **One formatter for money and dates.** The API sends integer cents; only
  `AmMoney` and `design-system/format.ts` turn them into text.
- **A gallery at `/design-system`** shows every component and variant, the job
  Storybook does at Ambrook (sidebar: Internal → Design system).

## How it works

```mermaid
flowchart LR
    Bank[Bank feed<br/>aggregator webhook] -->|POST /api/sync| Import
    subgraph Web[Next.js server]
        Import[Import<br/>idempotent upsert]
        API[Review API<br/>accept / reject / undo / manual]
    end
    Import -->|same DB transaction| DB[(SQLite<br/>bank txns, ledger,<br/>proposals, jobs)]
    Worker[Worker process] -->|claim job| DB
    Worker --> Matcher[Pure matcher<br/>candidates, score,<br/>assign, splits]
    Matcher -->|plan| Worker
    Worker -->|proposals| DB
    UI[Review UI] <--> API
    API -->|balanced journal entries| DB
    UI <--> Report[Consolidation<br/>computed on read]
    Report -->|read ledger,<br/>record sale decisions| DB
```

1. **Import** (`lib/services/import.ts`). Upserts on `(account, provider_txn_id)`
   so re-sent data is a no-op, books each line the naive way, and enqueues a
   matching job **in the same database transaction**.
2. **Worker** (`scripts/worker.ts`, `lib/services/jobs.ts`). A separate process
   claims jobs atomically, retries with exponential backoff, and recovers jobs
   from crashed workers. Bursts of imports are debounced into one run.
3. **Matcher** (`lib/matcher/`). A pure function: transactions in, plan out. No
   database, no clock, no network.
4. **Review** (`lib/services/proposals.ts`). A person accepts, rejects, or undoes.
   Nothing touches the books without a human decision. Before anything is
   posted, **pre-flight checks** (`lib/services/preflight.ts`) re-verify
   permissions, freshness, double-booking, amounts, closed periods, and a dry
   run of the journal entries, inside the same transaction as the write.
5. **Ledger** (`lib/services/ledger.ts`). Append-only double entry. Accepting
   posts reclassification entries; undo posts reversing entries. Nothing is
   ever updated or deleted.
6. **Consolidation** (`lib/services/consolidation.ts`). Reads every business's
   ledger, adds them up, eliminates what they owe each other and what they sold
   each other, and reports whether the result can be trusted yet.

### The matcher

```mermaid
flowchart TD
    A[All recent transactions] --> B[Candidates<br/>same amount or a few dollars short,<br/>different account,<br/>-1 to +5 business days]
    B --> C[Score each pair<br/>additive, every point has a reason]
    C --> D{score >= 0.40?}
    D -- no --> U[Unmatched]
    D -- yes --> E[Split graph into blocks<br/>union-find]
    E --> F[Exact max-weight assignment per block<br/>bitmask DP; greedy fallback if huge]
    F --> G[Bounded subset-sum on leftovers<br/>splits of up to 3 pieces]
    G --> H{score >= 0.75 and not a split or fee?}
    H -- yes --> High["Strong (bulk-acceptable)"]
    H -- no --> Review["Check (closer look)"]
```

**Scoring** (`lib/matcher/score.ts`): date closeness (45% weight), exact amount,
round amount, transfer wording, memo names the other account's last 4 digits,
memo names the other entity, shared reference number. Penalties: a memo that
looks like a real purchase or sale, or names a different account. Weights are
hand-set and explainable on purpose: there's no labelled data to train on yet,
and a reviewer (and an auditor) needs to see *why*.

**Why exact assignment, not greedy:** two identical $2,500 transfers two days
apart. Greedy grabs the closest-dated pair first and orphans the other two
transactions. Candidates only connect same-amount, close-date transactions, so
the graph splits into tiny blocks (usually 1x1) where an exact search is instant.

### The accounting

For each bank transaction in an accepted match, a reclassification entry moves
the amount out of whatever income or expense category the import guessed:

| Match type | Sender books | Receiver books |
|---|---|---|
| Same entity | Transfers in Transit (nets to 0) | Transfers in Transit |
| Between entities | Due from *receiver* (asset) | Due to *sender* (liability) |
| Fee taken in flight | | shortfall to Bank Fees |
| Business to owner's personal account | Owner's Draws (equity) | personal side tagged, not on business books |
| Owner's personal account to business | | Owner Contributions (equity) |

Across entities, every Due-from has an equal Due-to, so they cancel on
consolidation. The app checks this live, along with "every entry balances".

## Consolidated statements

![Consolidated statements, ready to share](docs/screenshot-consolidated.png)

Matching transfers fixes each business's own books. The reason that matters to
the family is what happens next: a lender to a multi-business operation looks at
**all of it together**. Consolidating means adding the businesses up and then
**eliminating** everything they did with each other, because a family can't owe
itself money or earn income from itself. Ambrook customer McKinney Land & Cattle
[credits better financial statements](https://hpj.com/2025/12/26/ambrook-launches-inventory-feature-for-ag-operators/)
with a $12M credit line at about 2 points lower; this is the multi-entity version
of that report.

Two kinds of activity between the businesses get eliminated, and the difference
between them is the point of the project:

| | Transfer (a loan, a sweep) | Sale (pasture rent, a hay sale) |
|---|---|---|
| Each business's own books | Reclassified: not income, not expense. Leaves a due-from / due-to | **Unchanged**: it really is the Land Co.'s income and the ranch's expense, and each files taxes on it |
| Who finds it | The matcher (it deliberately ignores sales: commerce words lower the score) | A separate check: same amount, close dates, real categories, a memo naming the other business |
| Consolidated report | Due-from and due-to cancel | Income and expense both shrink by the same amount; **profit doesn't change** |

With the demo data, consolidated revenue goes from **$657,652** before review
to **$188,767** after: $469K of it was money the family moved or paid itself.

**Readiness, not just numbers.** The report says whether it can be handed over.
Blocking checks: every proposed transfer is reviewed, every possible sale is
confirmed or dismissed, both sides agree on what each business owes the other,
and the balance sheet balances. A warning (not blocking) lists uncategorized
money, where a missed transfer might hide. Each failing check links to where it
gets fixed. It's the pre-flight idea again, applied to a report instead of a write.

Design choices:

- **Eliminations are computed in the report and never posted.** Each business's
  books stay its own; that's standard practice (consolidation worksheets) and
  means undoing a decision can't corrupt anyone's ledger.
- **Possible sales are found on every read**, not stored by the worker. It's one
  pass over a few hundred rows, so it can't go stale. Only a person's decision is
  stored (`intercompany_sales`), with partial unique indexes so a payment is in
  at most one confirmed sale. A confirmed sale can't then be matched as a transfer.
- **Choose which businesses to include.** Leave one out and its balances stay on
  the balance sheet, because to that group it's an outside party.
- **Permissions carry through.** A bookkeeper who sees one business gets that
  business's statements; deciding a sale needs access to both sides; the
  activity log hides decisions about businesses you can't see.
- **Opening balances** are posted at setup (bank feeds start mid-history), so
  the balance sheet has real cash, not just the period's net flow.

### Data model

```mermaid
erDiagram
    entities ||--o{ bank_accounts : owns
    entities ||--o{ ledger_accounts : "chart of accounts"
    bank_accounts ||--o{ bank_transactions : feeds
    bank_transactions ||--o{ match_legs : "in at most one LIVE match"
    match_proposals ||--|{ match_legs : groups
    match_proposals ||--o{ journal_entries : "applied as"
    bank_transactions ||--|| journal_entries : "imported as"
    journal_entries ||--|{ journal_lines : "debits = credits"
    users }o--o{ entities : "user_entity_access"
    bank_transactions ||--o| intercompany_sales : "buyer or seller side"
```

The invariant that matters most is enforced by the database, not app code:

```sql
CREATE UNIQUE INDEX one_live_match_per_transaction
  ON match_legs (transaction_id) WHERE active = 1;
```

If the background matcher and a person's manual match race for the same
transaction, the second write fails instead of double-booking money.

## Evaluation

On the synthetic feed (231 transactions: 38 real transfers, 9 look-alikes that
are not transfers, and 130 ordinary transactions):

| | |
|---|---|
| Real transfers found (any tier) | 97% (37 / 38) |
| Look-alikes correctly ignored | 8 / 9 |
| Ordinary transactions left alone | 130 / 130 |
| Precision, "Strong" tier (bulk-acceptable) | 100% (28 / 28) |
| Precision, "Check" tier | 90% (9 / 10) |
| Exact vs greedy assignment | 97% vs 92% recall |

Full report with window and threshold sweeps: [`data/eval_report.md`](data/eval_report.md).
The app's internal **Matcher diagnostics** page shows every case, its bank
lines, and how the matcher did on it.

**Read these numbers with care.** I wrote both the test scenarios and the
scoring weights, so this measures "does it handle the cases I thought of", not
real-world accuracy. It's a regression harness. In production the honest metric
is the reviewers' **rejection rate** on proposals, tracked over time.

### Held-out test

To check that, [`lib/stress.ts`](lib/stress.ts) is a second generator written
*after* the weights were set: different memo wording (`XXXXXX4821`, `BOOK
TRANSFER DEBIT`, `ACH CREDIT`), a realistic lag distribution, non-round
transfers, and round-number commerce (land rent, loan payments, Zelle) that
collides with transfer amounts. Each round is 25 customers x ~300 transactions.
Each round that taught something led to a fix, and the next round used fresh
seeds nobody had looked at:

| | Round 1 | Round 2 | Round 3 (fresh) |
|---|---|---|---|
| Strong-tier precision, before that round's fix | 99.6% | 99.5% | |
| Strong-tier precision, current matcher | 99.7% | 99.8% | **100% (663 / 663)** |
| Recall, current matcher | 97.2% | 97.5% | **97.7%** |
| Check-tier precision, current matcher | 91.0% | 93.4% | 92.0% |

What the rounds taught: memos reference accounts in more formats than `...4821`
(fixed); a memo naming a business outside the match is evidence against it, just
like naming another account (fixed); and most Check-tier false positives are
commerce the hard-coded categorizer doesn't recognize (**not** fixed with a
longer word list: in production the customer's own vendor list and tagging
history would supply that). Full report: [`data/heldout_report.md`](data/heldout_report.md).

### Performance

The realistic load is many customers with a few hundred transactions each, not
one giant ledger: matching only looks back 120 days, matched transfers drop out,
and each customer is its own job.

| | |
|---|---|
| 8,000 customers x ~300 transactions, one core | 48 s total; median 5.7 ms, p99 13 ms per customer |
| One customer with 3,000 / 10,000 transactions | 0.2 s / 1.4 s |
| Demo customer end to end in SQLite (import + match) | 13 ms + 18 ms |

The first benchmark run found matching growing much faster than the data (7.1 s
for 3,000 transactions). Profiling showed a day-by-day business-day count and a
brute-force split search; both were fixed (see [`data/bench_report.md`](data/bench_report.md)).

Why precision over recall: a false positive hides real money (a $5,000 feed bill
called a "transfer" disappears from expenses). A false negative just leaves a
transfer for a person to match by hand, which is the status quo.

## Where this borrows from Ambrook's playbook

| Their idea (public writing) | Where it shows up here |
|---|---|
| PlanBrook / AmDo: AI drafts a plan, a person reviews it, deterministic code executes it | Matcher proposes, reviewer decides, journal entries are posted by deterministic code |
| AmDo's pre-flight checks | Eight checks re-run inside the accept transaction and shown in the drawer; the same idea as readiness checks on the consolidated report |
| AmDo executes "only what the reviewing user could do by hand" | Every apply runs with the reviewer's own entity permissions |
| AI principle: deterministic foundations come first | Explainable scoring, no model, before anything learned |
| Software factory: idempotency keys on webhooks | Idempotent bank import; deduplicated job queue |
| Review Mode: a personalized list to work through | Review queue with auto-advance and keyboard shortcuts |
| Multi-entity: Ambrook Pay transfers "recorded in both sets of books" | Matched bank transfers booked on both entities' books |
| Full-stack design system: `Am` components, logic and presentation apart, shared types | `design-system/`, `lib/domain.ts` checked against the schema, and a `/design-system` gallery |
| Statements that match the business, for lenders (Inventory's market-value balance sheet) | Consolidated statements across entities, with eliminations and a readiness check |
| Coding to Cut Carbon: splitting a cost across fields | Split transfers: one withdrawal across several deposits |

## Design decisions and tradeoffs

| Decision | Alternative | Why |
|---|---|---|
| Propose, review, then apply | Auto-apply above a threshold | Books feed taxes and loans. Trust is earned; bulk-accept keeps review fast. |
| Hand-weighted additive score | ML classifier | No labels yet; every point must be explainable. Reviewer decisions become the training set later. |
| Exact assignment per block | Greedy | Greedy mis-pairs identical same-week transfers (measured: -6pp recall). Blocks keep exact search cheap. |
| Splits always go to review | Treat like 1:1 | Subset-sum can find coincidental combinations. |
| Matching in a background worker | Inline in the import request | Webhook handlers must return fast; matching re-runs as late counterparts arrive. |
| DB-table job queue | Redis / Pub/Sub / Cloud Tasks | Enqueue is transactional with the import (no lost jobs, no outbox needed). Fine at this scale. |
| Optimistic locking (version column) | Row locks held while a person reviews | People take minutes to decide; holding locks that long doesn't work. |
| Append-only ledger | Update entries in place | Audit trail; undo is a reversing entry; accountants expect it. |
| Due-to / Due-from for intercompany | Equity contribution / distribution | The safe default. Which treatment is right is a judgment call for the owner or their accountant (future: let them choose). |
| SQLite | Postgres | Zero setup for a demo. Production: Postgres (row locks, `SKIP LOCKED` for workers). |
| Eliminations only in the report | Post elimination entries to a "consolidation entity" | Nothing to reverse when a decision changes; each business's books stay exactly what it files. |
| Possible sales computed on read | Stored proposals from the worker, like transfers | Cheap at this size and never stale. With much more data, move it into the matching job. |
| A sale needs a memo naming the other business | Amount and date only | Same-amount payments to neighbors are common (the R MILLER rent case). Precision over recall; unnamed ones can be added by hand later. |

## What's built vs. designed

| Built here | Production design |
|---|---|
| SQLite file | Postgres (Cloud SQL) |
| Polling worker process | Cloud Run worker fed by Cloud Tasks / Pub/Sub |
| `x-user-id` header and a user switcher | Firebase Auth ID token verified server-side |
| Demo "sync" button | Bank-data aggregator webhooks, pending to posted reconciliation |
| Synthetic labelled feed | Reviewer accept/reject decisions as labels, rejection-rate dashboards |
| Consolidated statements on screen | PDF/Excel export for the lender, comparative periods, a shareable read-only link |

## Limitations and what I'd do next

- **Paper checks between entities** are the remaining recall gap: no transfer
  wording at all. Fix: match check numbers against the check register, or read
  the check image.
- **Learn per-customer patterns.** "Auto transfer to SAV ...7730 every other
  Friday" should become a rule after a few accepts.
- **Learn from rejections.** Today a rejection only blocks that exact pairing.
  Repeated rejections of a pattern (say, payments to "R MILLER") should lower
  the score of similar pairs.
- **Unrealized profit on intercompany sales.** If Cedar still has the hay it
  bought from Hollis Ranch, the consolidated balance sheet should carry it at
  Hollis's cost, not Cedar's price. That needs inventory quantities and cost,
  which is exactly what Ambrook Inventory tracks.
- **Personal statements.** Farm lenders often want the owner's personal balance
  sheet combined with the businesses'. The personal account is connected but
  left out of consolidation here.
- **Many-to-many splits** aren't supported (rare, and ambiguous).
- **Holidays** are ignored in business-day math.
- **Multi-tenant**: every table would carry an `org_id`, and the job queue's
  dedupe key would be per org.

## Project layout

```
db/schema.sql               tables, indexes, invariants
lib/matcher/                the pure matching algorithm (+ tests)
lib/services/               import, jobs, matching runs, proposals, pre-flight, ledger, books, consolidation (+ tests)
lib/org.ts                  the demo organization
design-system/              Am components, colors, formatting
app/                        Next.js UI and API routes (and the /design-system gallery)
scripts/                    generate data, seed, worker, eval
data/                       synthetic bank feed, ground truth, eval report
```
