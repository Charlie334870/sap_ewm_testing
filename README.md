# EWM Agent

An AI engineering and support agent platform for SAP EWM. A ticket comes in; the agent
investigates the SAP system through controlled read-only tools, identifies the root cause with
evidence, proposes a fix with risk and test plan, and a consultant approves every change.

**Status: Milestone 2 (read-only SAP tools).** On top of the Milestone 1 foundation there are now
eleven read-only EWM tools behind a policy gateway, a simulated SAP system with planted faults, a
real connection to SAP's public API sandbox, and an MCP server that lets Claude use the tools.
There is still no connection to a customer SAP system and no built-in agent.

| Milestone | Scope                                                              | State    |
| --------- | ------------------------------------------------------------------ | -------- |
| M1        | Foundation: monorepo, database, login, roles, tickets, audit, UI   | Built    |
| M2        | Read-only EWM tools, gateway, simulated SAP, SAP API sandbox, MCP  | Built    |
| M3        | Built-in agent: investigation loop, evidence rules, evaluation     | Next     |
| M4        | Project knowledge base and search with citations                   | Planned  |
| M5        | Solution, risk, test plan and approval record                      | Planned  |
| M6        | Read-only connector for customer SAP systems (needs a real system) | Deferred |

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
  mcp/            MCP server (stdio) that lets Claude read tickets and run the read-only tools
packages/
  shared/         Vocabularies and request schemas used by both API and web
  database/       Schema, SQL migrations, database client
  auth/           Password hashing, session and access tokens, role permissions
  audit/          Append-only, hash-chained audit log
  sap-tools/      Tool contracts, tool gateway, simulated SAP, SAP API sandbox connector
docs/
  SETUP.md                 How to run it, for someone who is not a developer
  SAP-CONNECTION.md        How the platform reaches SAP, what is verified and what is not
  CONNECT-CLAUDE.md        How to let Claude Desktop use the tools
  milestones/              What each milestone delivers and how it was checked
  architecture/            MVP architecture and implementation plan (Word) and its generator
infrastructure/   Database init scripts
tests/            Scenario answer keys and tests that each scenario can be solved with the tools
```

Packages for the model provider, the built-in agent and the knowledge base are added in the
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
- **No fake SAP.** Every tool result says where it came from: _Simulated_ (hazard-tape tag),
  _SAP sandbox_ (SAP's demo data) or, later, a customer system. A simulated result never passes
  as real, and customer systems cannot be registered yet.
- **Read-only tools, one gateway.** Every tool call goes through one gateway that checks project,
  role, environment, input and output, applies a time limit, and records the call, including
  refused ones. No tool that changes SAP exists.
- **No invented SAP details.** The sandbox connector is built only from service definitions SAP
  published. Tools SAP has released no API for are refused with the reason, not approximated.
- **Secrets.** Passwords are stored as scrypt hashes; session and agent access tokens only as
  SHA-256 hashes; SAP API keys encrypted with a key held outside the database. None of them
  appears in logs, API responses or audit entries.

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
