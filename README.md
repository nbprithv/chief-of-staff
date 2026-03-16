# Personal Executive Assistant

A local-first personal assistant built with Node.js + Fastify + SQLite (Drizzle ORM) + Claude.

## Stack

| Layer | Tech |
|---|---|
| API server | Fastify + TypeScript |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| AI | Anthropic Claude (via SDK) |
| Integrations | Gmail + Google Calendar |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `DB_PATH` — defaults to `./data/assistant.db` (auto-created)
- Google credentials — optional until you build the Gmail/Calendar integration

### 3. Generate and run migrations

```bash
npm run db:generate   # generates SQL from schema files
npm run db:migrate    # applies migrations to the SQLite file
```

### 4. Start the server

```bash
npm run dev
```

API runs at `http://127.0.0.1:3000`.

### 5. Browse your data (optional)

```bash
npm run db:studio
```

Opens Drizzle Studio — a local web UI to inspect and edit your SQLite data.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Server status |
| GET | `/api/v1/tasks` | List tasks (filter: status, project_id, due_before) |
| GET | `/api/v1/tasks/inbox` | Untriaged tasks with no project |
| GET | `/api/v1/tasks/due-soon` | Tasks due within N days (default 3) |
| POST | `/api/v1/tasks` | Create a task |
| PATCH | `/api/v1/tasks/:id` | Update a task |
| DELETE | `/api/v1/tasks/:id` | Delete a task |

## Project structure

```
src/
├── db/
│   ├── client.ts          ← Drizzle + better-sqlite3 singleton
│   ├── migrate.ts         ← migration runner (npm run db:migrate)
│   └── schema/            ← one schema file per domain
│       ├── index.ts
│       ├── projects.schema.ts
│       ├── tasks.schema.ts
│       ├── emails.schema.ts
│       ├── calendar.schema.ts
│       ├── grocery.schema.ts
│       ├── research.schema.ts
│       ├── briefing.schema.ts
│       ├── recommendations.schema.ts
│       └── habits.schema.ts
├── domains/               ← one folder per feature — router + service + types
├── ai/                    ← Claude pipelines
├── integrations/          ← Gmail and Google Calendar sync
└── core/                  ← config, logger, errors, middleware
```
