# Snack Counter Automation

Take-home assignment for Framsikt: automating snack-counter refills for the Oslo and Bengaluru offices.

## Run

```bash
npm install
npm test           # run the tests
npm run typecheck  # type-check the code
```

## Structure

```
src/
  domain/    business types and rules (Money, Refill, Volunteer)
  services/  use-cases (lifecycle, assignment, budget, report)
  ports/     interfaces for external systems (chat, HR)
  adapters/  fake chat + fake HR used in tests
tests/
```

## Progress

- [x] Phase 1: project setup, Money (integer minor units), domain types
- [x] Phase 2: refill lifecycle (state machine, optimistic locking)
- [x] Phase 3: choosing who buys (fair rotation)
- [ ] Phase 4: timeouts and reassignment
- [ ] Phase 5: budget check
- [ ] Phase 6: fake chat / HR + monthly report
- [ ] Phase 7: design document
