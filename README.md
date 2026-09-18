# Astrology AI Agent

A Fastify + TypeScript + MongoDB backend for a voice-and-text
astrology AI agent: a persona-switching companion/astrologer
that talks over a WebSocket, backed by a real astrology
calculation MCP server, OpenAI for LLM/STT/TTS/embeddings, and
its own memory + knowledge-base retrieval.

See [ROADMAP.md](./ROADMAP.md) for what's built, what's
in-progress, and design decisions with their rationale.

## Project Structure

```text
astrology-ai-agent/
├── src/
│   ├── app/                # Fastify app, DI container, config
│   ├── modules/
│   │   ├── auth/            # Register/login, JWT, ownership guards
│   │   ├── user/             # Accounts
│   │   ├── birth-profile/    # A user's own birth details
│   │   ├── partner-profile/  # A second person's birth details, scoped to a conversation
│   │   ├── conversation/     # Persistence, rolling summarization, context window
│   │   ├── agent/            # Planner → MCP/RAG/memory execution → streaming response
│   │   ├── astrology/        # Astrology MCP client, tool registry, cache, argument resolution
│   │   ├── memory/           # Long-term personalization (extraction, embeddings, retrieval)
│   │   ├── rag/               # Knowledge-card retrieval (wired, not yet populated with content)
│   │   └── realtime/          # WebSocket gateway (text + voice turns)
│   ├── infrastructure/       # Mongo/Redis, LLM, Speech (STT/TTS), Embeddings, Observability
│   ├── shared/                # Errors, types, utils, constants
│   └── index.ts               # Entry point
├── scripts/                   # DB seed scripts (knowledge cards not yet populated — see §5 in ROADMAP.md)
└── tests/                     # unit/ (pure logic) · integration/ (real in-memory Mongo) · e2e/ (real Fastify + WebSocket)
```

## Getting Started

### Prerequisites

- A MongoDB Atlas connection string (Atlas specifically — not
  required today, but §4/§5 assume it if vector search is ever
  added later).
- A Redis instance (for MCP result caching).
- An OpenAI API key (used for the LLM, STT, TTS, and
  embeddings — one key covers all of it).
- Access to an astrology calculation MCP server (URL + API key).

### Installation

```bash
npm install
cp .env.example .env
# then fill in .env — see below
```

### Required environment variables

See `.env.example` for the full list with defaults. The ones
with no safe default that you must set yourself:

| Variable | Purpose |
|---|---|
| `MONGO_URI` | Primary datastore |
| `REDIS_URL` | MCP result cache |
| `LLM_API_KEY` | OpenAI key — also used for STT/TTS/embeddings |
| `ASTROLOGY_MCP_SERVER_URL` / `ASTROLOGY_MCP_API_KEY` | Astrology calculation server |
| `JWT_SECRET` | Auth token signing — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |

### Running

```bash
npm run dev         # tsx watch, auto-reload
npm run typecheck   # tsc --noEmit
npm run build        # tsc
npm start            # node dist/index.js, after building
```

### Testing

```bash
npm test               # everything: unit + integration + e2e
npm run test:unit       # pure logic, no I/O — instant
npm run test:integration  # real in-memory MongoDB, fake LLM
npm run test:e2e         # real Fastify app + real WebSocket + real in-memory Mongo, fake LLM
npm run test:watch       # vitest watch mode
```

No test here calls a real paid API (OpenAI, the astrology MCP
server) — only the LLM call itself is faked, via a small
canned-response client that still exercises the real planner/
response/summarizer parsing and validation logic. Everything
else (Mongo, the WebSocket protocol, auth, persistence,
summarization triggering) is real, using `mongodb-memory-server`
for a genuine (if ephemeral) MongoDB instance rather than a
mocked driver. See `tests/e2e/realtime-turn.test.ts` for the
fullest example.

## API overview

All endpoints except `POST /auth/register`, `POST /auth/login`,
`/health`, `/ready`, and `/metrics` require
`Authorization: Bearer <token>` and are scoped to the
authenticated user (or a conversation they own) — see
`modules/auth`.

- **Auth**: `POST /auth/register`, `POST /auth/login`
- **Users**: `GET/PATCH /users/:userId`
- **Birth profile**: `POST/GET/PATCH /users/:userId/birth-profile`
- **Partner profile** (per-conversation): `POST/GET/PATCH/DELETE /conversations/:conversationId/partner-profile`
- **Conversations**: `POST/GET /users/:userId/conversations`, `GET/PATCH /conversations/:conversationId`, `POST/GET /conversations/:conversationId/messages`
- **Realtime (chat + voice)**: `GET /ws?token=<jwt>` — WebSocket. See `modules/realtime/realtime.types.ts` for the full client/server event protocol (`chat:send`, `audio:start`/binary frames/`audio:end`, `turn:mode`, etc).
- **Ops**: `GET /health`, `GET /ready` (checks Mongo/Redis/MCP reachability), `GET /metrics` (Prometheus)

## Observability

- Structured logs via Pino (`infrastructure/observability/logger.ts`).
- Prometheus metrics at `GET /metrics` (`infrastructure/observability/metrics.ts`) — HTTP/LLM/MCP call durations, active WS connections, agent turns, rate-limit rejections.
- Lightweight span tracing (`infrastructure/observability/tracing.ts`) logged as structured Pino events with `traceId`/`spanId`/`parentSpanId` — not the OpenTelemetry SDK; see the file's own comment for why and how to graduate to it later.

## Data privacy

See [PRIVACY.md](./PRIVACY.md) for what's stored, retention,
and deletion.
