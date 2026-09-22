# Astrology AI Agent

A Fastify + TypeScript + MongoDB backend for a voice-and-text
astrology AI agent: a persona-switching companion/astrologer
that talks over a WebSocket, backed by a real astrology
calculation MCP server, Gemini for LLM/STT/TTS (OpenAI for
embeddings only, always — see `EMBEDDING_PROVIDER` in
`.env.example`; both LLM/STT/TTS clients are swappable per-
provider via `LLM_PROVIDER`/`STT_PROVIDER`/`TTS_PROVIDER`), and
its own memory + knowledge-base retrieval.

The original feature-build roadmap (§1-§7, all done) has been
superseded — [ROADMAP.md](./ROADMAP.md) now tracks a specific,
active project: a three-tier voice pipeline (Free/Gold/Diamond
subscription plans, each a genuinely different, progressively
faster architecture — cascaded STT→LLM→TTS, audio-input LLM, and
full Live-API speech-to-speech respectively), selected per user
by a `plan` field checked at WebSocket connect time.

## Project Structure

```text
astrology-ai-agent/
├── server/
│   ├── src/
│   │   ├── app/                # Fastify app, DI container, config
│   │   ├── modules/
│   │   │   ├── auth/            # Phone+OTP and email/password login, JWT, ownership guards
│   │   │   ├── user/             # Accounts
│   │   │   ├── birth-profile/    # A user's own birth details
│   │   │   ├── partner-profile/  # A second person's birth details, scoped to a conversation
│   │   │   ├── conversation/     # Persistence, rolling summarization, context window
│   │   │   ├── agent/            # Planner → MCP/RAG/memory execution → streaming response
│   │   │   ├── astrology/        # Astrology MCP client, tool registry, cache, argument resolution
│   │   │   ├── memory/           # Long-term personalization (extraction, embeddings, retrieval)
│   │   │   ├── rag/               # Knowledge-card retrieval (wired, not yet populated with content)
│   │   │   └── realtime/          # WebSocket gateway (text + voice turns)
│   │   ├── infrastructure/       # Mongo/Redis, LLM, Speech (STT/TTS), Embeddings, Observability
│   │   ├── shared/                # Errors, types, utils, constants
│   │   └── index.ts               # Entry point
│   ├── scripts/                   # DB seed scripts (knowledge cards not yet populated — deliberately out of MVP scope)
│   └── tests/                     # unit/ (pure logic) · integration/ (real in-memory Mongo) · e2e/ (real Fastify + WebSocket)
└── app/                # Expo (React Native) client — prebuild/CNG workflow, see its own section below
    └── src/
        ├── api/         # Fetch wrapper + typed calls to the server (auth, user, birth-profile)
        ├── hooks/        # useAuthFlow — the phone/OTP + onboarding state machine
        ├── screens/       # Phone → OTP → name → birth-profile → home
        ├── config.ts       # API_BASE_URL (localhost, platform-aware)
        ├── storage.ts       # JWT persistence (AsyncStorage)
        └── utils/jwt.ts      # Decodes the JWT payload client-side (no verification — display/routing only)
```

## Getting Started

All commands below (`npm install`, `npm run dev`, `npm test`,
etc.) are run from inside the `server/` directory.

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
cd server
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
| `LLM_API_KEY` | OpenAI key — always used for embeddings; also for LLM/STT/TTS if their `*_PROVIDER` is "openai" |
| `GEMINI_API_KEY` | Google Gemini key — required since `LLM_PROVIDER`/`STT_PROVIDER`/`TTS_PROVIDER` default to "gemini" |
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

No global path prefix — all routes below are root-level, registered in `server/src/app/app.ts`.
Every response is enveloped `{success: true, data: ...}` or `{success: false, error: {code, message}}`.

All endpoints except `POST /auth/register`, `POST /auth/login`,
`POST /auth/otp/request`, `POST /auth/otp/verify`, `/`,
`/health`, `/ready`, and `/metrics` require
`Authorization: Bearer <token>` and are scoped to the
authenticated user (or a conversation they own) — see
`modules/auth`.

**Ownership guards** (`auth.guards.ts`): `requireSelf(param)` 403s unless the JWT's `userId` matches the route param.
`requireConversationOwnership` loads the conversation by `:conversationId`, 404s if missing, 403s unless it belongs to the caller — used wherever ownership can't be checked from the param name alone (messages, partner-profile).

### Ops (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Liveness/info — `{service, status: "running"}` |
| GET | `/health` | Basic liveness — `{status, service, environment, timestamp}` |
| GET | `/ready` | Readiness — pings Mongo/Redis/astrology MCP concurrently; 200 or 503 with per-dependency status |
| GET | `/metrics` | Prometheus scrape endpoint |

### Auth (`modules/auth`, no auth required)

The app uses phone+OTP (its only login screen). Email/password still exists
alongside it — same `User` model, same JWT — kept for the existing e2e test
and as a non-phone path; nothing currently exposes it in the app UI.

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/auth/otp/request` | `{phoneNumber}` | "Sends" an OTP — no SMS provider wired up yet, so this just validates the phone number and returns `{message}`. Static OTP for now, see below |
| POST | `/auth/otp/verify` | `{phoneNumber, otp}` | Verifies `otp === "1234"` (hardcoded — `STATIC_OTP` in `auth.service.ts`), finds-or-creates the user by phone number, returns `{user, token, isNewUser}` |
| POST | `/auth/register` | `{email, password, name?}` | Create account (bcrypt-hashed password), returns `{user, token}` (201) |
| POST | `/auth/login` | `{email, password}` | Verify credentials, returns `{user, token}` |

`User.email`/`phoneNumber`/`passwordHash` are all optional at the schema
level (mutually exclusive in practice) — a phone+OTP account has no
password, an email/password account has no phone number. `isNewUser` is
how the app decides whether to run onboarding (name → birth profile) right
after verification; a returning user with both already set goes straight
to `home`. See `POST /users/:userId/birth-profile` above for where the
birth details onboarding step lands.

### Places (`modules/places`, authenticated — not resource-scoped)

The app resolves a typed place name to coordinates **on-device**, via
`expo-location`'s native geocoder (Apple/Google Maps under the OS — no API
key, no server round trip for that part; see the Mobile app section below).
This route is the one server-side step left: resolving *those* coordinates
to an IANA timezone, via an offline lookup (`tz-lookup`) — no external API,
no key, no network call, always available. The user still never
enters/sees raw latitude/longitude.

| Method | Path | Query | Purpose |
|---|---|---|---|
| GET | `/places/timezone` | `?latitude=&longitude=` | `{timezone}` — e.g. `26.9124,75.7873` → `"Asia/Kolkata"` |

### Users (`modules/user`) — `requireSelf("userId")`

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/users/:userId` | — | Fetch own user record |
| PATCH | `/users/:userId` | `{name?, avatarUrl?, isActive?}` | Update own profile fields |
| DELETE | `/users/:userId` | — | Cascade-delete account (birth profile, partner profiles, conversations+messages, memories, then the user); 204 |

### Birth profile (`modules/birth-profile`) — `requireSelf("userId")`

The authenticated user's own birth details — primary input to astrology MCP tools. No DELETE (only via account cascade-delete).

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/users/:userId/birth-profile` | `{dateOfBirth, timeOfBirth, placeOfBirth, latitude, longitude, timezone, timeOfBirthVerified?}` | Create (201) |
| GET | `/users/:userId/birth-profile` | — | Fetch; 404 if none |
| PATCH | `/users/:userId/birth-profile` | same fields, all optional | Update; 404 if none |

### Partner profile (`modules/partner-profile`) — `requireConversationOwnership`

A second person's birth details, scoped 1:1 to a conversation (for synastry/compatibility tools) — not a system user.

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/conversations/:conversationId/partner-profile` | `{name?, dateOfBirth, timeOfBirth, placeOfBirth, latitude, longitude, timezone, timeOfBirthVerified?}` | Create (201) |
| GET | `/conversations/:conversationId/partner-profile` | — | Fetch; 404 if none |
| PATCH | `/conversations/:conversationId/partner-profile` | same fields, all optional | Update; 404 if none |
| DELETE | `/conversations/:conversationId/partner-profile` | — | Delete; 204 |

### Conversations (`modules/conversation`)

| Method | Path | Auth | Body/Query | Purpose |
|---|---|---|---|---|
| POST | `/users/:userId/conversations` | `requireSelf("userId")` | `{title?}` | Create conversation (201) |
| GET | `/users/:userId/conversations` | `requireSelf("userId")` | query `{limit?=20, skip?=0}` | List, paginated |
| GET | `/conversations/:conversationId` | `requireConversationOwnership` | — | Fetch one; 404 if none |
| PATCH | `/conversations/:conversationId` | `requireConversationOwnership` | `{title?, status?, summary?, currentTopic?, lastPersonaMode?, summarizedUntil?}` | Update metadata |
| POST | `/conversations/:conversationId/messages` | `requireConversationOwnership` | `{role, content, contentType?, metadata?}` — `userId` taken from JWT, not body | Append message (201) |
| GET | `/conversations/:conversationId/messages` | `requireConversationOwnership` | query `{limit?=20}` | Fetch recent messages |

### Realtime — WebSocket (`modules/realtime`)

**`GET /ws?token=<jwt>`** — upgrades to WebSocket. Auth is a `token` query param (WS upgrade requests can't carry custom headers); verified server-side before upgrading, 401s (JSON) if missing/invalid. `session.userId` always comes from the verified token, never the client.

Per-user in-process turn rate limit (`chatMaxPerMinute`, separate from the REST rate limiter) — exceeding it emits `chat:error`/`audio:error` ("Rate limit exceeded") instead of closing the socket.

Text control/status messages are JSON (`{type, requestId, payload?}`). **Audio is raw binary WS frames in both directions** (no base64/JSON wrapping) since it's the highest-frequency payload.

Client → server: audio is uploaded as one frame after recording stops, not streamed progressively — client streams binary frames between `audio:start`/`audio:end`, but in practice that's a single frame containing the whole `.m4a` file, sent once `.stop()` has finalized it. Progressive chunked upload (reading deltas off the still-recording file and sending them early) was tried and reverted — see `useVoiceSession.ts`'s comment above `delay()` for why.

Server → client: synthesized TTS audio is sent speculatively per-sentence, each sentence wrapped in `audio:sentence_start {index}` / binary frames / `audio:sentence_end {index}` — see `realtime.types.ts`'s wire-format note. This lets the client treat each sentence as an independently-playable clip and start playing the first one while later sentences are still being synthesized, instead of buffering the whole reply.

Client → server:

| Event | Payload | Effect |
|---|---|---|
| `session:start` | `{conversationId?}` | Optionally binds session to a conversation (ownership checked server-side); replies `session:ready {sessionId}` |
| `chat:send` | `{message}` | Runs a text turn: `chat:started` → `turn:mode` → `chat:delta`* → `chat:completed`/`chat:error` |
| `chat:cancel` | — | Aborts the active turn; replies `chat:cancelled` or `audio:cancelled` |
| `audio:start` | `{format?, sampleRate?}` | Opens the binary-audio buffer for a voice turn |
| `audio:end` | — | Runs STT → agent turn → speculative TTS: `audio:transcribed` → `turn:mode` → (`audio:sentence_start` → binary audio frames → `audio:sentence_end`)* → `audio:completed`/`audio:error` |
| `session:end` | — | Cancels any active turn and closes the socket |

Server → client:

| Event | Payload | When |
|---|---|---|
| `session:ready` | `{sessionId}` | Ack for `session:start` |
| `chat:started` / `chat:completed` / `chat:cancelled` | `{}` | Text turn lifecycle |
| `chat:delta` | `{text}` | Streaming text chunk |
| `chat:error` | `{message}` | Text turn, parse/validation, or rate-limit error |
| `audio:transcribed` | `{text}` | STT result |
| `audio:sentence_start` / `audio:sentence_end` | `{index}` | Opens/closes one sentence's binary audio segment |
| *(binary frame)* | raw audio bytes | Synthesized TTS chunk, between a sentence's start/end markers |
| `audio:completed` / `audio:cancelled` | `{}` | Voice turn lifecycle |
| `audio:error` | `{message}` | STT/agent/TTS or rate-limit error |
| `turn:mode` | `{personaMode: "companion"\|"astrologer"\|"blended", responseMode: "direct"\|"mcp"\|"rag"\|"mcp_rag"}` | Once per turn (text or voice), as soon as the planner decides — before generation starts |

Full type definitions: `server/src/modules/realtime/realtime.types.ts` and `realtime.protocol.ts`.

## Mobile app (`app/`)

Expo (React Native) client, scaffolded for the prebuild/CNG
workflow (`npx expo prebuild` generates `android/` — and `ios/`
once run from macOS/Linux; both are gitignored and regenerated,
never committed).

The app's flow is auth + onboarding — phone number → OTP
(`1234`, static for now) → name → birth profile → a push-to-talk
voice screen (`HomeScreen.tsx` — see "Voice (`/ws`)" below).

The birth-profile step uses native calendar/time pickers
(`@react-native-community/datetimepicker`) and a place-of-birth
lookup (`PlaceSearchInput.tsx`) — both native modules, see
"Adding a native dependency" below. Place lookup resolves
on-device via `expo-location`'s native geocoder (Apple/Google
Maps under the OS — no API key) when the user finishes typing
and taps out of the field (no live-as-you-type suggestions —
the native geocoder doesn't do predictive search the way Google
Places Autocomplete did); the resolved coordinates are then sent
to the server's `/places/timezone` above to fill in the
timezone. The user never enters or sees raw latitude/longitude.
Android will prompt for a one-time location permission the
first time a place is resolved (`expo-location`'s Android
geocoding requires it even though no GPS fix is taken — see the
`expo-location` plugin config in `app.json`).

### Voice (`/ws`)

`useVoiceSession` (`src/realtime/useVoiceSession.ts`) drives a
push-to-talk turn against the server's realtime gateway — see
that module's own doc comment, and the "Realtime — WebSocket"
section above for the protocol it implements. Short version:

- On mount: creates a conversation (`POST
  /users/:userId/conversations`), opens the socket, sends
  `session:start`.
- Hold the mic button: `expo-audio` records to `.m4a`
  (`RecordingPresets.HIGH_QUALITY`); release sends `audio:start
  {format:"m4a"}`, the recorded file's bytes as one binary WS
  frame (`expo-file-system`'s `File.bytes()`), then `audio:end`.
- Reply audio arrives framed per sentence
  (`audio:sentence_start`/binary frames/`audio:sentence_end`);
  each sentence's frames are buffered separately and queued for
  playback as soon as its `sentence_end` arrives, written to its
  own temp file (`expo-file-system`'s `Paths.cache`) and played
  via `expo-audio`'s imperative `createAudioPlayer` — the queue
  drains one clip at a time, starting the first as soon as it's
  ready rather than waiting for the whole reply.
- Text chat (`chat:send`) isn't wired into the app yet — only the
  voice path.

Android prompts for a one-time microphone permission on first
use (`expo-audio`'s plugin config in `app.json`).

### Running against the local server

```bash
cd app
npm install
npm start          # then press 'a' (Android), 'i' (iOS), or 'w' (web)
```

`src/config.ts` picks a `localhost`-based `API_BASE_URL`
automatically:
- iOS simulator / web: `http://localhost:3000`
- Android emulator: `http://10.0.2.2:3000` (the emulator's alias
  for the host machine's `localhost` — plain `localhost` inside
  the emulator means the emulator itself)

Override with `EXPO_PUBLIC_API_URL` (`cp .env.example .env`) if
the server runs on a different port (check `server/.env`'s
`PORT`) or you're testing on a physical device over Wi-Fi, where
neither of the above resolves to your dev machine — use its LAN
IP instead.

The server's CORS is wide open (`CORS_ORIGIN=*` by default), so
no server-side change is needed to talk to the app from any of
these origins.

### Adding a native dependency

Because the app uses the prebuild/CNG workflow (not Expo Go), a
package with native code (`npx expo install <package>`) isn't
usable just by saving — Metro reloading JS doesn't recompile the
native binary already installed on the device/emulator, and
you'll see `TurboModuleRegistry.getEnforcing(...): '<Module>'
could not be found`. After installing one:

```bash
npx expo prebuild --clean   # regenerate android/ (and ios/, on macOS/Linux) from scratch
npx expo run:android        # or run:ios — recompiles and reinstalls
```

`--clean` matters here, not just a plain `prebuild` — the native
project's CMake/autolinking config is otherwise stale relative to
the newly-added module and the native build fails. If a rebuild
fails with a locked `app-debug.apk`/file, a leftover `expo
run:android` process from a previous attempt is almost always
why — kill it and retry.

## Observability

- Structured logs via Pino (`infrastructure/observability/logger.ts`).
- Prometheus metrics at `GET /metrics` (`infrastructure/observability/metrics.ts`) — HTTP/LLM/MCP call durations, active WS connections, agent turns, rate-limit rejections.
- Lightweight span tracing (`infrastructure/observability/tracing.ts`) logged as structured Pino events with `traceId`/`spanId`/`parentSpanId` — not the OpenTelemetry SDK; see the file's own comment for why and how to graduate to it later.

## Data privacy

See [PRIVACY.md](./PRIVACY.md) for what's stored, retention,
and deletion.
