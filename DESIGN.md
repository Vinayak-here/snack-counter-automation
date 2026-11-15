# Snack Counter Automation — Design

Turns "the box is empty" into one named buyer, an HR claim filed the moment the receipt is uploaded, and one monthly report for Oslo and Bengaluru. TypeScript on Node 22, ports and adapters, fake chat and HR, 96 automated tests.

## 1. Lifecycle: from "empty" to "reimbursed"

Each "box is empty" report becomes one `Refill`, which can only move along these transitions; any other move throws.

```
OPEN ──ask──▶ ASSIGNED ──yes──▶ ACCEPTED ──buy──▶ PURCHASED ──claim──▶ CLAIM_SUBMITTED ──HR pays──▶ REIMBURSED
 ▲  │            │                 │                                         └──HR rejects──▶ CLAIM_REJECTED
 │  └── volunteer without being asked ──▶ ACCEPTED
 └── decline, or timeout (2 h to answer, 24 h to buy) ── from ASSIGNED / ACCEPTED
OPEN / ASSIGNED / ACCEPTED ──cancel──▶ CANCELLED (never after buying)
```

Anyone reports "empty" in chat. The rotation messages one eligible person with the budget left. A yes is announced in the office channel; a no, or 2 hours of silence, moves it to the next person. The buyer uploads amount, items and receipt in the office's currency. The HR claim is filed at once, and a sync job records HR's decision and tells the buyer.

## 2. Main parts and the data each keeps

Rules are pure domain code, services run the use-cases, and storage, time, chat and HR sit behind ports that are faked in tests.

| Part | Keeps / does |
| --- | --- |
| `Refill` | Status, `version`, assignee and timestamps, who declined or timed out, purchase (amount, items, receipt, over-budget flag), HR claim ID |
| `Volunteer`, `Office` | Home and **current** office, presence, opt-out; currency, monthly budget, time zone |
| `Money` | Integer øre or paise plus currency; mixing currencies throws |
| Domain rules | State machine table, rotation, timeouts, budget, report: all pure functions |
| Services | `RefillService` (every change, with optimistic locking), `AssignmentService`, `TimeoutService`, `BudgetService`, `ReportService`, `SnackWorkflow` (entry point for chat bot and scheduler) |
| Ports | `RefillRepository` (in memory), `VolunteerDirectory`, `Clock` (fake in tests), `ChatPort`, `HrPort` |

## 3. How the problems are prevented

| Problem today | Prevention |
| --- | --- |
| Box stays empty | One named person is asked. 2 h without an answer, or 24 h without buying, moves it on. Nobody available: the office channel is asked, and it retries when someone arrives |
| Two people buy the same day | One refill per office can await purchase. Accepting is an atomic check-and-set on `version`: concurrent accepts have one winner, announced in the channel |
| A few people do most refills and wait weeks | Rotation: fewest purchases in 30 days, then longest since the last. Only active people in that office today (covers visitors). Claim filed at receipt upload |
| Spend and snacks unknown | Spend per office per month in its own currency; one monthly report for both offices with top snacks and a NOK total |

The two concurrency rules are proven by tests that fire both requests at the same moment and assert exactly one succeeds.

## 4. Trade-offs and assumptions

- **Optimistic locking, not locks.** Clashes are rare, so nobody waits; in SQL Server this is a `rowversion` column.
- **Over budget is flagged, not blocked.** The volunteer has already paid; a `BLOCK` policy exists if wanted.
- **Spend counted at purchase**, not at HR payout up to 10 days later. Rejected claims are excluded; the month is taken in the office's time zone.
- **Budgets in each office's currency.** Only the report converts, with a stored monthly rate, so it is reproducible.
- **HR down:** the purchase is kept and the claim retried; the refill ID as idempotency key prevents paying twice. A late "yes" beats a timeout.

**Assumptions:** 2 h to answer and 24 h to buy (configurable); visitors buy and claim for the office they are in; a rejected claim needs a human; the report is in NOK.

## 5. What I deliberately won't build

- A real chat bot or HR integration: the ports exist, only fakes are built.
- A database, HTTP API, UI, or the scheduler that runs the sweeps.
- Sensors or auto-ordering; authentication (the company login is assumed).
- Escalation when everyone declines; analytics beyond the monthly report.
