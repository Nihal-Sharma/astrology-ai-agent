# Data Privacy & Retention

Internal reference for what this service stores, why, and how
to delete it. Written against the actual code as of §6
(Platform/Security) — not aspirational.

## What is stored, and why

| Data | Where | Why |
|---|---|---|
| Email, name, bcrypt password hash | `User` | Account identity/auth. Password is never stored in plaintext or logged. |
| Date/time/place of birth, lat/lon, timezone | `BirthProfile` | Required input to every astrology calculation. |
| A second person's birth details | `PartnerProfile` | User-supplied, for synastry/compatibility questions. **This is the one place the service holds another person's data without that person having interacted with it directly.** |
| Full conversation text (user + assistant turns) | `ConversationMessage` | The chat itself — includes both astrology Q&A and, in "companion" persona mode, more personal/emotional content. |
| Rolling conversation summary | `Conversation.summary` | Long-context memory within a conversation. |
| Extracted personal facts (name, preferences, relationships, life events) | `MemoryItem` | Cross-conversation personalization (§4). Each fact is a short LLM-generated sentence plus an embedding vector, not raw message text. |

Third parties this data passes through: **OpenAI** (LLM
generation, STT/TTS, embeddings — conversation content and
extracted facts are sent to OpenAI's API per their own data
usage terms) and the **astrology calculation MCP provider**
(birth details are sent to compute charts). No other
third-party processors are used today.

## Retention

No automatic expiry exists yet — data is kept indefinitely
until deleted. This is a real gap for a production launch, not
just an oversight: an explicit retention window (e.g. auto-
archiving conversations inactive for N months) is a product
decision, not a purely technical one, and is left for whoever
makes that call before real users are onboarded. Until then,
retention is "as long as the account exists."

## Deletion

`DELETE /users/:userId` (authenticated, self-only) cascades
through every collection this document lists:

1. `BirthProfile` for that user
2. `PartnerProfile` rows the user added (across all their conversations)
3. `Conversation` + `ConversationMessage` for that user
4. `MemoryItem` for that user
5. The `User` record itself, last

See `AppContainer.deleteUserAccount` (`src/app/container.ts`)
for the implementation — it's a container-level operation
rather than living in any one module's service, since it's the
one operation that legitimately spans every module's data.

**Known gap**: deletion is immediate and permanent (hard
delete, no soft-delete/grace period, no export-before-delete
flow). That's the simplest correct behavior for "the user asked
to be forgotten," but means there's no recovery if a deletion
was a mistake — worth revisiting if this becomes a self-serve
consumer product rather than an MVP.

## Handling recommendations for whoever operates this in production

- Rotate `JWT_SECRET`, `MONGO_URI`, `REDIS_URL`, `LLM_API_KEY`,
  and `ASTROLOGY_MCP_API_KEY` credentials periodically and keep
  them out of version control (`.env` is gitignored; only
  `.env.example` — with no real values — is tracked).
- `passwordHash` is `select: false` at the schema level, so it
  is never returned by normal queries; only the two auth flows
  that need it explicitly re-select it (see
  `UserRepository.findByEmail`).
- `GET /metrics` and `GET /health`/`GET /ready` are
  unauthenticated by design (that's how Prometheus/uptime
  checks normally reach them) but expose no PII — only
  aggregated counts/durations and dependency up/down status.
  Restrict network access to them at the infrastructure level
  if this is deployed somewhere `/metrics` would otherwise be
  publicly reachable.
