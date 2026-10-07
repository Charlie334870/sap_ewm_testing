# tests

Scenario packs and the evaluation harness live here from Milestone 2 onward: each pack is a
simulated warehouse state with a planted root cause and an answer key the agent never sees.

Automated tests for the code sit next to the code they test:

- `apps/api/test/` — API tests against a real PostgreSQL database
- `packages/*/src/*.test.ts` — unit tests
