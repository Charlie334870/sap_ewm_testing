# EWM Agent

An AI engineering and support agent platform for SAP EWM. A ticket comes in; the agent
investigates the SAP system through controlled read-only tools, identifies the root cause with
evidence, proposes a fix with risk and test plan, and a consultant approves every change.

**Status: Milestone 1 (foundation).** Login, roles, projects, SAP system records, tickets and a
tamper-evident audit log work. There is no SAP connection and no AI agent in the code yet.

| Milestone | Scope                                                             | State    |
| --------- | ----------------------------------------------------------------- | -------- |
| M1        | Foundation: monorepo, database, login, roles, tickets, audit, UI  | Built    |
| M2        | Ten read-only EWM tools, tool gateway, simulated SAP adapter, MCP | Next     |
| M3        | Agent investigation loop, evidence rules, evaluation harness      | Planned  |
| M4        | Project knowledge base and search with citations                  | Planned  |
| M5        | Solution, risk, test plan and approval record                     | Planned  |
| M6        | Real SAP read-only connector (needs a real system)                | Deferred |

## Start it

You need Docker Desktop. Then:

```bash
cp .env.example .env        # then edit the three values marked CHANGE ME
docker compose up --build
```

Open <http://localhost:3000> and sign in with the administrator email and password from `.env`.

Step-by-step instructions, including Windows commands and troubleshooting: [docs/SETUP.md](docs/SETUP.md).

## What is where

```
apps/
  api/            REST API (Fastify). Applies migrations on start. Tests in apps/api/test.
  web/            Web console (Next.js). The browser talks only to this; it forwards /api to the API.
packages/
  shared/         Vocabularies and request schemas used by both API and web
  database/       Schema, SQL migrations, database client
  auth/           Password hashing, session tokens, role permissions
  audit/          Append-only, hash-chained audit log
docs/
  SETUP.md                 How to run it, for someone who is not a developer
  milestones/M1.md         What Milestone 1 delivers and how it was checked
  architecture/            MVP architecture and implementation plan (Word) and its generator
infrastructure/   Database init scripts
tests/            Scenario packs and evaluation harness (from Milestone 2)
```

Packages for the SAP tools, MCP server, model provider, agent and knowledge base are added in the
milestone that builds them.

## Rules the code enforces

- **Project isolation.** Every project-scoped row carries `project_id`. One function,
  `requireProjectAccess`, gates every project route. A project you cannot see answers "not found",
  the same as one that does not exist.
- **Roles.** Analyst raises tickets. Consultant also changes ticket status and reads the audit
  log. Project admin also manages members and SAP systems. An organisation administrator is admin
  on every project of the organisation and manages users.
- **Audit.** Every state-changing request writes an audit entry in the same database transaction
  as the change. The table rejects UPDATE, DELETE and TRUNCATE, and each entry is hash-chained to
  the one before it, so tampering by someone with full database rights is detectable.
- **No fake SAP.** Only systems marked _simulated_ can be registered. The interface marks every
  simulated system with a hazard-tape tag.
- **Secrets.** Passwords are stored as scrypt hashes; session tokens only as SHA-256 hashes.
  Neither appears in logs or audit entries.

## Develop

Requires Node.js 22 and pnpm (`corepack enable`).

```bash
pnpm install
docker compose up -d db     # database only, on localhost:5433
pnpm dev                    # API on :4000, web on :3000, both reload on change
pnpm test                   # API and unit tests against the ewm_test database
pnpm typecheck && pnpm lint
```

After changing `packages/database/src/schema.ts`, run `pnpm db:generate` and commit the new file in
`packages/database/migrations`.
