# Snack Counter Automation

Take-home assignment for Framsikt: automating snack-counter refills for the Oslo and Bengaluru offices, from "the box is empty" to "the volunteer is reimbursed".

**Design:** see [DESIGN.md](DESIGN.md) for the lifecycle, the main parts, how each problem is prevented, trade-offs and what is deliberately not built.

## Run

Requires Node 22.

```bash
npm install
npm test           # 96 tests
npm run typecheck  # strict TypeScript, no emit
```

## Structure (hexagonal: ports and adapters)

```
src/
  domain/     pure rules: Money, types, state machine, rotation, timeouts, budget, report
  ports/      interfaces to the outside: RefillRepository, VolunteerDirectory, Clock, ChatPort, HrPort
  adapters/   in-memory storage, FakeClock, FakeChat, FakeHr
  services/   use-cases: RefillService, AssignmentService, TimeoutService,
              BudgetService, ReportService, SnackWorkflow (entry point for chat + scheduler)
tests/        one file per area; tests/workflow.test.ts runs the whole flow end to end
```

## What the tests cover

| File | Covers |
| --- | --- |
| `money.test.ts` | integer minor units, no currency mixing |
| `refillStateMachine.test.ts` | allowed and forbidden transitions |
| `inMemoryRefillRepository.test.ts` | optimistic locking, one active refill per office, defensive copies |
| `refillLifecycle.test.ts` | full lifecycle; **two people can't both commit to the same refill** |
| `rotation.test.ts`, `assignment.test.ts` | fair rotation, presence, visitors |
| `timeouts.test.ts` | **a refill nobody completes is handed to someone else**; late accept vs timeout |
| `budget.test.ts` | **budgets and totals correct across both currencies**; over-budget flag/block |
| `workflow.test.ts` | chat messages, HR claim filing, HR down + retry without duplicates |
| `report.test.ts` | monthly report across both offices with a stored exchange rate |

## Progress

- [x] Phase 1: project setup, Money (integer minor units), domain types
- [x] Phase 2: refill lifecycle (state machine, optimistic locking)
- [x] Phase 3: choosing who buys (fair rotation)
- [x] Phase 4: timeouts and reassignment
- [x] Phase 5: budget check
- [x] Phase 6: fake chat / HR + monthly report
- [x] Phase 7: design document
