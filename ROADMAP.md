# Roadmap — Three-Tier Voice Pipeline (Free / Gold / Diamond)

Supersedes the previous single-track latency roadmap. The product
direction changed: instead of migrating everyone to one new
architecture, three tiers coexist permanently, each a genuinely
different pipeline, gated by subscription plan:

| Tier | Pipeline | Speed (intended) | Speed (measured, Phase C) |
|---|---|---|---|
| **Free** | Audio → STT → LLM (planner + response) → MCP → TTS | Slowest (today's cascade, already live) | ~19.9s total (an older, pre-optimization sample — see Phase 0/A history above; needs a fresh same-day run to compare fairly) |
| **Gold** | Audio → LLM (audio input, no separate STT) → MCP → TTS | Mid | **~22-24s total, twice** — not meaningfully faster than Free in practice; see Phase C's live-test entries below for why (TTS and response generation dominate, and both are identical code in every tier) |
| **Diamond** | Audio → LLM (Live API, speech-to-speech) → MCP → Audio | Fastest | Built and live-verified (Phase D) — **one real run**: ~3.0s to first audio, ~17.4s total, including a real MCP tool call. Promising vs. Gold's ~5-6s/~13-19s, but one run isn't enough to call it yet — see Phase D. |

We go step by step. Each step gets checked off (`- [x]`) here once
it's actually done and **verified live** — not just written or
typechecked. This integration has already hit real, live-only
surprises (three rejected TTS mime types in a row, then a JSON
markdown-fence bug) purely from assumptions that looked right on
paper — assume every new step here needs the same live check before
being trusted.

---

## External services / new dependencies

- **Gemini Live API** (`ai.live.connect()`, `@google/genai`) — powers
  Diamond tier. Same Gemini account/`GEMINI_API_KEY` already in use;
  a different API surface (a persistent bidirectional session, not
  request/response) with different, likely higher, per-minute
  billing. **Resolved**: the real model is `gemini-3.1-flash-live-
  preview` (config: `LIVE_MODEL`) — the SDK's own example model names
  (`gemini-live-2.5-flash-preview`, `gemini-2.0-flash-live-preview-
  04-09`) turned out to be stale/nonexistent for this API version,
  confirmed live the same way `gemini-3.1-flash-tts-preview`'s
  accepted format turned out to differ from what any doc excerpt
  suggested — see Phase D.
- **Gemini audio-input on `generateContent`** (Gold tier) — no new
  service or credential, just a different call shape (an inline
  audio `Part` alongside the text prompt) on the client we already
  have.
- **`react-native-webrtc`** — **not needed**. Diamond's transport
  decision (see Phase D) resolved to the server-proxied WebSocket,
  reusing the existing `/ws` gateway and push-to-talk protocol
  unchanged — no app-side native module or rebuild required.
- **A payment/subscription/billing provider** (Stripe, Razorpay, or
  similar) — needed eventually to actually let users buy/upgrade a
  plan. **Explicitly out of scope for this roadmap.** Everything
  below assumes `User.plan` can be set directly (e.g. a manual Mongo
  update, or a simple admin-only endpoint for testing) rather than
  through a real purchase flow.
- No other new vendors. Mongo, Redis, and the astrology MCP server
  are unaffected by any of this — this roadmap only changes the
  voice transport/reasoning path.

---

## Phase A — Plan-based routing (shared infrastructure, build first)

This is the actual answer to "how do we know which path to follow"
— everything in Phases B/C/D plugs into this. Nothing tier-specific
should be built before this exists, or it'll need rewiring later.

- [x] Add `plan: "free" | "gold" | "diamond"` to the `User` model/
      schema, default `"free"` — every existing user is Free until
      explicitly upgraded. `VoicePlan` type lives in `user.types.ts`.
- [x] Decide how a plan actually gets set for now — **decided: a
      dedicated script, not an HTTP endpoint at all**, self-serve or
      admin-gated. There's no admin-role concept anywhere in this
      codebase yet, and standing one up just to gate a placeholder
      felt like more risk (a half-built auth boundary) than a
      script run by whoever already has DB/deploy access. Deliberately
      excluded from `UpdateUserInput`/the existing self-service
      `PATCH /users/:userId` so it can never be set that way, even
      by accident — see `scripts/set-user-plan.ts` (`npx tsx
      scripts/set-user-plan.ts <phoneNumber|userId> <free|gold|
      diamond>`) and `UserRepository.setPlan`/`UserService.setPlan`.
- [x] At WebSocket connect time (`realtime.gateway.ts`'s connection
      handler, right after `session.userId` is derived from the
      verified token) fetch the user's current `plan` from Mongo and
      attach it to `RealtimeSessionContext.plan`. Done as a
      fire-and-forget lookup that starts before `socket.on("message",
      ...)` is registered but isn't awaited before registering it —
      `session.plan` starts as `"free"` and is overwritten once the
      lookup resolves (typically within a few ms, one indexed
      `findById`); a message arriving in that narrow window would
      see the default, which is harmless today since nothing branches
      on `plan` yet beyond a log line (see below).
- [x] **Staleness tolerance decided**: plan is looked up once per
      WebSocket connection, not re-checked mid-session — an upgrade
      takes effect on the user's next reconnect, not instantly
      mid-call. Matches how the app already reconnects on drop
      (`RECONNECT_DELAY_MS`), so it's a bounded, acceptable delay.
- [x] **Scoped down from the original plan on purpose**: rather than
      building `FreeVoicePipeline`/`GoldVoicePipeline`/
      `DiamondVoicePipeline` as real classes now, `RealtimeService.
      processAudio()` gained a single explicit branch point — if
      `session.plan !== "free"`, it logs that no dedicated pipeline
      exists yet and falls through to the existing cascade. Building
      two empty pipeline classes with no real behavior (Gold/Diamond
      don't exist until Phase C/D) would have been dead scaffolding;
      this branch point is the one place Phase C/D need to hook into
      instead, and it's already exercised by every non-Free-tier
      session today (as a no-op fallback, logged). The real
      extraction into a formal `VoicePipeline` interface + Free's own
      class is still Phase B's job, not done here.
- [x] **Fallback decision**: made concrete for today's actual state —
      Gold/Diamond currently fall back to the Free cascade
      unconditionally (nothing to fail yet, since neither pipeline
      exists). The harder version of this question is still open and
      belongs in Phase D once that pipeline is real: if a Diamond-
      tier user's Live API session fails to establish (quota, region,
      outage), does that turn/session degrade to Gold or Free, or
      hard-error with a clear message? Decide and document before
      Phase D ships this to real users — don't leave it as an
      accident of whatever the first implementation happens to do.

## Phase B — Free tier (baseline — already fully live)

Today's existing cascade, unchanged — just needs to be wrapped
behind Phase A's interface, not rebuilt.

- [x] STT (`GeminiSttClient`) → planner → parallel MCP/RAG/memory →
      response generation → TTS (`GeminiTtsClient`, WAV-wrapped raw
      PCM) — fully implemented and live-verified this session,
      including the JSON code-fence fix.
- [x] Extracted into `FreeVoicePipeline` (`realtime/pipelines/free-
      voice.pipeline.ts`), implementing the `VoicePipeline` interface
      (`realtime/pipelines/voice-pipeline.types.ts`) — the cascade
      itself (STT → concurrent display-translation + agent turn →
      speculative sentence-by-sentence TTS) moved verbatim, no
      behavior change. `RealtimeService.processAudio` is now a thin
      session/protocol layer (validation, rate limiting,
      `activeAbortController` lifecycle, the plan→pipeline dispatch
      point) that delegates via `yield*` to whichever pipeline
      `session.plan` picks — today always `FreeVoicePipeline`, with
      the Gold/Diamond-falls-back-to-Free log line now living at
      that one dispatch point instead of being buried inside the
      cascade. `popReadySentence` moved to `realtime/pipelines/
      sentence.ts` (needed by the pipeline, and keeping it in
      `realtime.service.ts` would have created a circular import
      once the service imports the pipeline). Verified: typecheck
      clean, full suite (84/84, including the real-WebSocket e2e
      test that exercises gateway → RealtimeService →
      FreeVoicePipeline end to end) passes unchanged.

## Phase C — Gold tier: audio-input planner (skip the separate STT call)

The idea from this session's chat: instead of a dedicated
upload-then-transcribe STT round-trip, feed the raw audio straight
into the planner call and have it transcribe *and* decide the
routing plan in one shot.

- [x] Extended `LlmGenerateInput` (`llm.types.ts`) with an optional
      `audio?: { data: Buffer; mimeType: string }` field.
      `OpenAiLlmClient` ignores it (no current caller needs audio on
      the OpenAI path).
- [x] Extended `GeminiLlmClient.generate()`/`stream()` to attach
      that audio as an inline `Part` on the last message, exactly as
      planned — `generateContent`'s `Part` type already supported
      this, no need for the `interactions` API.
- [x] Extended the planner's output schema/type with a `transcript`
      field — **made it optional, not required as originally
      written**. A required field would have forced every text-input
      planner call (Free tier, text chat) to echo back
      `window.currentMessage` as `transcript` for no reason; optional
      means it's only ever populated when audio was actually
      attached, and `PlannerService.createPlan` throws if audio was
      given but no transcript came back — so the "must be present
      for audio calls" guarantee still holds, just enforced in code
      instead of the schema.
- [x] Updated `planner.prompt.ts`: a new "AUDIO INPUT" section
      explaining when/how to transcribe, and the output-format
      skeleton now shows `transcript` with an explicit note that
      it's audio-only and should be omitted otherwise.
- [x] Built `GoldVoicePipeline` — **required substantially more than
      the original one-line plan anticipated**, because of a real
      chicken-and-egg problem: `ContextBuilder.build()`'s memory
      retrieval needs message *text* to embed, but for audio input
      there is no text until the combined transcribe+plan call
      returns. Turned out the planner's own prompt never reads
      `window.memories` at all (only `ContextWindowBuilder`'s token
      budget did), so the fix was narrower than it first looked:
      - `ContextBuilder.build()`'s `message` param is now optional;
        omitting it skips memory retrieval (`[]`) instead of
        guessing, everything else (conversation history, birth/
        partner profile) is unaffected since none of it depends on
        message text.
      - `AgentOrchestrator` split into `runTextTurn` (existing
        behavior, unchanged) and a new `runAudioTurn`, both
        delegating to a shared `executeAndRespond` phase (MCP/RAG
        execution, response generation, persistence) — `runAudioTurn`
        builds a text-less context, calls the planner with audio,
        derives the transcript from the returned plan, *then*
        persists the user's turn and patches `window.currentMessage`
        before continuing into the shared phase. New public
        `AgentService.streamTurnWithAudio` / `AgentOrchestrator.
        streamTurnWithAudio`, alongside the untouched `streamTurn`.
      - New `AgentStreamEvent` variant, `{type: "transcript", text}`,
        yielded once the planner call resolves (audio-turn only).
      - `SentenceSynthesizer` and `DisplayTranslator` extracted out
        of `FreeVoicePipeline` into their own shared classes
        (`realtime/pipelines/`) — Gold tier needs the identical
        sentence-framed TTS + Hindi-display-translation logic, and
        duplicating the English/Hindi-enforcement code across two
        pipelines was a real drift risk, not just a style
        preference. `FreeVoicePipeline` now uses these too — refactor
        only, no behavior change (84/84 tests still passed
        afterward).
      - `GoldVoicePipeline.processAudio` mirrors `FreeVoicePipeline`'s
        concurrency trick (kick off display-translation and keep
        driving the agent turn forward at the same time) — the first
        event out of `streamTurnWithAudio` is always `"transcript"`,
        so that's the hook point instead of a separately-awaited STT
        call.
      - `resolveAudioMimeType` (`shared/utils/audio-mime.ts`)
        extracted so `GeminiSttClient` and `GoldVoicePipeline` share
        one format→MIME mapping instead of two copies that could
        drift.
      - `RealtimeService` now takes both `freeVoicePipeline` and
        `goldVoicePipeline`, and `resolvePipeline()` actually routes
        `session.plan === "gold"` to the new pipeline — Diamond still
        falls back to Free with a log line (Phase D still not built).
      - Verified: typecheck clean throughout every step, full suite
        (91/91 — 7 new tests: planner-schema's `transcript` cases,
        `resolveAudioMimeType`'s format mapping) passes, including
        the real-Mongo/real-WebSocket e2e test exercising the
        **unchanged** text-turn path end to end after the
        `AgentOrchestrator` split.
- [x] **First live test run, and it found a real bug** (fifth
      live-only surprise this session): the combined transcribe+plan
      call itself worked (`hasAudio: true`, 2.4s, model
      `gemini-3.1-flash-lite`) — but the response failed schema
      validation. Specifically: `mcp.required`/`rag.required`/
      `memory.required` all came back correctly, but every *detail*
      field under them (`tools`, `parallel`, `targetDate`,
      `queries`, `topK`) came back `undefined` — the model correctly
      decided nothing was needed, then didn't bother filling in the
      now-irrelevant details, and the schema rejected that as
      malformed rather than treating it as the harmless "nothing to
      do here" it actually is. Same class of bug as the historical
      `topK: 0` fix, just across every detail field at once,
      apparently triggered more easily with audio attached than on
      text-only calls (which have run this same schema hundreds of
      times this session without hitting it). Fixed by adding
      `.default(...)` to every detail field in `agentPlanSchema`
      (tools→`[]`, parallel→`false`, targetDate/targetRangeDays→
      `null`, queries→`[]`, topK→`0`) — applies to both tiers, not
      Gold-specific, and is a strict robustness improvement either
      way. Also reinforced `planner.prompt.ts` to explicitly say
      "always include every key, even when required is false."
      2 new regression tests. Typecheck clean, 93/93.
- [x] **Full turn confirmed live, twice, consistently** — both
      completed end to end (STT-merge → MCP/RAG/memory execution →
      response generation → TTS → persistence), same casual
      "companion"/"direct" message shape both times:

      | | Run 1 | Run 2 |
      |---|---|---|
      | `transcribeAndPlanMs` | 3318 | 3494 |
      | `timeToFirstTextDeltaMs` | 3065 | 2749 |
      | `timeToFirstAudioChunkMs` | 13100 | 12095 |
      | `totalTurnMs` | 23870 | 22425 |

      Both runs also show a `gemini-3.8-flash` `generate()` call
      (no audio) a couple seconds after the turn finished, with no
      accompanying error — matches `MemoryExtractor`'s fingerprint
      exactly (fire-and-forget, main model, runs after the reply).
      Circumstantial but consistent twice now: memory extraction is
      firing correctly for Gold turns, same as Free — expected,
      since `executeAndRespond` is the same code either way, but
      good to see it actually happen.
- [x] **Measured — and the honest answer is "it doesn't matter yet."**
      `transcribeAndPlanMs` (~3.3-3.5s) is the one thing Gold
      actually changes, but it's dwarfed by two costs that are
      *identical in both tiers* and dominate the total:
      - **TTS has a large fixed per-call cost, not a per-character
        one.** Six sentences across both runs: 6/45/24/11/48/17
        characters took 5851/5021/5195/6714/6098/4548ms
        respectively — a 6-character reply took *longer* to
        synthesize than a 45-character one. `gemini-3.1-flash-tts-
        preview` is paying a large fixed latency per
        `synthesizeStream` call almost regardless of text length.
      - **Response generation is slow for very little output**:
        77-78 output characters took 17.7s and 19.4s respectively,
        across both runs.

      Both of these sit in `executeAndRespond`/`SentenceSynthesizer`
      — shared, unmodified by which tier is selected. Even if Gold's
      transcribe+plan step is genuinely ~1-2s faster than Free's
      separate STT+planner (still not directly A/B tested against a
      fresh Free-tier run), that saving is close to invisible next
      to ~17-19s of response generation and ~15-17s of cumulative
      TTS time. **Gold tier is not meaningfully faster than Free
      tier today** — not because the Phase C work was wrong, but
      because the bottleneck this whole roadmap is chasing turned
      out to live somewhere neither tier touches. Worth a dedicated
      follow-up investigation into TTS/response-generation latency
      specifically — likely higher-leverage than anything left in
      Phase C or D.

## Phase D — Diamond tier: Gemini Live API (full speech-to-speech)

The full architectural migration originally scoped as this
project's only plan — now scoped to Diamond-tier users specifically,
not a hard cutover. One persistent model session that listens,
reasons, and speaks in one integrated loop; no separate STT/planner/
TTS calls at all.

- [x] **Resolves Phase A's open question**: "if a Diamond-tier user's
      Live API session fails to establish (quota, region, outage),
      does that turn/session degrade to Gold or Free, or hard-error?"
      — **decided: hard-error, no automatic tier downgrade.**
      `DiamondVoicePipeline` catches connect/session failures and
      yields `audio:error` with a message; it does not fall back to
      Gold/Free mid-turn. Simplest correct behavior for now — a
      Diamond user silently getting a different (slower, differently-
      priced) tier's behavior without being told would be more
      confusing than a clear error. Revisit only if live failure rates
      turn out to justify the extra complexity of an automatic
      downgrade path.
- [x] **Transport decision: server-proxied WebSocket, reusing the
      existing `/ws` gateway** — resolved in practice, not just in
      theory: `DiamondVoicePipeline` is live-verified working through
      the exact same `audio:start`/binary frame(s)/`audio:end`
      protocol Free/Gold already use (see the app-transport bullet
      below). No WebRTC, no client rewrite, no new gateway protocol.
- [x] **Foundational `infrastructure/live/` module built and live-verified.**
      `live.types.ts` defines a provider-independent `LiveClient`/
      `LiveSession`/`LiveSessionEvent` interface (mirrors the existing
      `LlmClient`/`STTClient`/`TTSClient` pattern on purpose — Diamond
      code depends on these types, never on `@google/genai`'s Live
      shapes directly). `gemini-live.client.ts` implements it, bridging
      the SDK's callback-based API into the async-iterable style used
      everywhere else via Node's `events.on()`.
      **Live-tested end-to-end through this module** (not just the raw
      SDK) with a stub tool, confirming every piece Diamond needs:
      - Correct model: `gemini-3.1-flash-live-preview`. The SDK's own
        doc-comment `@example` blocks reference `gemini-live-2.5-flash-
        preview` / `gemini-2.0-flash-live-preview-04-09` — **both are
        stale/wrong**, same failure mode as every other doc-vs-reality
        gap this project has hit. Real Live-capable models were found
        by calling `ListModels` directly and filtering for
        `bidiGenerateContent` support.
      - **Input audio must be 16-bit PCM, mono, 16kHz** exactly
        (`audio/pcm;rate=16000`). Sending our TTS pipeline's native
        24kHz PCM produces **zero response and no error** — the API
        doesn't reject it, it just silently never replies. A linear-
        resample step from 24kHz→16kHz is required wherever Diamond
        feeds audio in.
      - **`sendRealtimeInput({audioStreamEnd: true})` is required** to
        reliably close out voice-activity-detection and get a reply —
        added to our interface as `LiveSession.endAudioTurn()`, called
        on the same `audio:end` gateway event Free/Gold already use.
        This means Diamond can likely keep the same push-to-talk
        protocol as Free/Gold (see the continuous-streaming bullet
        below — may no longer be required).
      - Input/output transcription, audio-out streaming, and the full
        `tool_call` → `sendToolResult` → model-resumes-and-uses-the-
        result round trip all confirmed working through our wrapper.
      - **SDK gap found and guarded against**: the SDK's own
        `live.connect()` promise awaits a server `setupComplete`
        message that never arrives when setup fails (e.g. bad model
        name) — the server closes the socket with a real reason (code
        1008 + message), but the SDK doesn't surface it, so `connect()`
        hangs forever instead of rejecting. Confirmed live by raw-
        `ws` testing against the same endpoint. Fixed with our own
        `withConnectTimeout` (15s) wrapper in `gemini-live.client.ts`
        so a future bad model/config can't hang a Diamond session
        indefinitely.
      - **A second, more subtle bug found building `DiamondVoicePipeline`
        itself**: sending a whole turn's audio chunks back-to-back with
        no pacing at all (a plain synchronous loop, no `await` between
        `sendAudioChunk` calls) makes the Live API accept the
        connection and the audio fine, then **emit zero events for the
        rest of the turn** — no transcript, no error, nothing, forever.
        Isolated by testing the exact same burst against the raw SDK
        directly (same silent hang) vs. the working wrapper with a
        20ms delay between chunks (works every time) — some server-
        side ingestion/VAD state doesn't tolerate a whole turn landing
        in one burst. Fixed with a small delay between chunks
        (`DiamondVoicePipeline.sendAudioPaced`).
      - The app sends `.m4a` (AAC), not raw PCM (`audio:start
        {format:"m4a"}`) — Free/Gold forward that directly to Gemini's
        regular `generateContent`, which decodes containers itself,
        but confirmed live the Live API's `sendRealtimeInput` does
        NOT (`sendClientContent` with inline container audio was also
        tried — rejected live: "Operation is not implemented"). Added
        `shared/utils/audio-transcode.ts` (`decodeToPcm16`, via
        `ffmpeg-static` — a new dependency, no system ffmpeg required)
        to decode `.m4a` → 16-bit PCM/16kHz server-side before it ever
        reaches the Live session. Verified live against a real
        ffmpeg-encoded `.m4a` clip, not just WAV.
- [x] Confirmed actual Live API access/quota/pricing works for this
      account — every live test in this section ran against the real
      API with the real key, including a full real turn with a real
      MCP tool call through the real astrology server.
- [x] **Decided how MCP/persona map onto a Live session** (RAG/memory
      remain partially open — see below):
      - **MCP tools**: `astrologyToolRegistry.getEnabled()` mapped to
        `LiveToolDeclaration[]` with **deliberately empty/permissive
        parameter schemas** (`{type:"object",properties:{},required:[]}`),
        not each tool's real `inputSchema` — the real schemas demand
        birth-profile fields (day/month/year/lat/lon/tzone) the model
        has no business filling in; `AstrologyService.executeTools`
        already derives those server-side from the user's stored
        profile regardless of what's passed (same as Free/Gold), so
        showing the model that schema would only invite hallucinated
        astronomical values. The model just calls a tool by name.
        Live-verified for real: the model correctly called `planets`
        unprompted, the server resolved the user's real birth profile,
        executed against the real astrology MCP server, and the model
        used the result correctly in its spoken reply.
      - **Persona mode**: no per-turn planner to pick one, so
        `DiamondVoicePipeline` uses `context.previousPersonaMode ??
        "blended"` once at session connect (via `buildResponseSystemPrompt`,
        the same builder Free/Gold's response step uses) — simplest
        option that still respects a returning conversation's established
        mode. No mid-session mode switching yet.
      - [x] **Memory retrieval: built and live-verified, via a Diamond-only
        mechanism.** The system instruction is built once, before any user
        message exists, so there's nothing to search memories with at that
        point (same limitation `ContextBuilder.build`'s own doc comment
        documents for Gold's pre-transcript build) — Free/Gold's two
        mechanisms (Free's upfront `ContextBuilder` fallback, Gold's
        `plan.memory.required` targeted search) both need a planner
        decision to hang off of, and Diamond has no planner step at all.
        **Fix**: a dedicated `recall_user_memory` Live tool
        (`DiamondVoicePipeline.buildToolDeclarations`/`executeMemorySearch`),
        backed by `MemoryService.retrieve` — the model decides at runtime
        whether something's worth recalling, same as it already decides
        when to call an astrology tool. Unlike the astrology tools'
        deliberately empty schemas, this one takes a real model-supplied
        `query` argument, since a search string has no "correct" server-
        derivable value to protect against hallucination.
        **Live-verified** (2026-09-23): told the model a fact in one turn
        ("my favorite color is purple"), asked about it in a later turn on
        the same connection — it said a short acknowledgment ("Wait, let
        me check...", confirming the acknowledgment-filler instruction
        generalizes beyond astrology tools) then correctly recalled
        "purple". Full write→read round trip confirmed against real Mongo
        data. See Diamond-flow.md's "Memory retrieval" section.
      - **RAG (knowledge-card) retrieval: still open**, same root cause and
        same fix should apply — expose `RAGService.retrieve` as another
        Live tool, not built yet.
- [x] **Decided: mask tool-call latency with a spoken acknowledgment,
      not silence.** Confirmed mechanism first — the Live API isn't
      truly concurrent: the model halts its own generation to emit a
      function-call event, we run the real MCP call (same
      `AstrologyService`/`McpExecutor`, same Redis-backed `McpCache`
      — a cache hit is tens of ms, a cold call is a real round-trip
      to the astrology server), call `session.sendToolResponse(...)`,
      and only then does the model resume and actually speak. That
      gap is genuine dead air unless we hide it.
      **Fix, starting soft (prompt-only)**: the Diamond session's
      system instructions require a short in-character acknowledgment
      line, in English or Hindi (matching the existing
      `isEnglishOrHindi` restriction), *before* every tool call —
      never go silent while looking something up. "Kundali" is the
      natural word to lean on here, e.g.:
      ```
      Whenever you need to call an astrology tool, say a short, warm
      acknowledgment FIRST, in the same language/register you've been
      speaking, before making the call — never go silent while
      looking something up. Examples:
      - "एक मिनट, आपकी कुंडली देखती हूँ..."
      - "Wait, let me have a quick look at your kundali..."
      - "होल्ड ऑन, चार्ट चेक कर रही हूँ..."
      Keep it brief — one short sentence, not a speech. Then make
      the call.
      ```
      This is prompt steering, not an API guarantee — reliable in
      practice for a capable model given concrete examples, but not
      "always." **Deliberately not building a hard fallback yet**
      (server-side: detect a `toolCall` event, and if no
      acknowledgment audio arrived in the last N ms, synthesize a
      canned filler line ourselves) — that's real extra engineering
      (a timer, a fallback TTS path, injected audio) that's only
      worth it if live testing shows the model skipping the
      acknowledgment often enough to matter. Revisit after the first
      live Diamond tool-call test, the same "verify before hardening"
      pattern every other tier in this roadmap followed.
      Also worth deciding at the same time: the model can chain
      multiple tool calls in one turn before finally speaking, so the
      silent window can be the sum of several calls, not just one —
      the instruction above should probably also cover that case
      (one acknowledgment covering the whole lookup, not one per
      call) once this is actually being tested live.
- [x] **`DiamondVoicePipeline` built** (`realtime/pipelines/diamond-voice.pipeline.ts`)
      — implements the same `VoicePipeline` interface as Free/Gold
      (`processAudio`), plus an optional `dispose(session)` added to
      that interface for Diamond's own need: unlike Free/Gold
      (stateless per turn), Diamond keeps ONE Live session alive per
      WebSocket connection across every turn (so conversation context
      stays inside the Live session itself, its whole point — no per-
      turn context rebuild), created lazily on the connection's first
      turn and torn down via `dispose()` on disconnect
      (`realtime.gateway.ts`'s socket `"close"` handler, routed through
      `RealtimeService.disposeSession`). Session state keyed by the
      `RealtimeSessionContext` object itself, recreated if
      `conversationId` ever changes mid-connection.
      Outbound audio reuses Free/Gold's existing `audio:sentence_start`/
      binary frame(s)/`audio:sentence_end` framing (same reason
      `GeminiTtsClient.synthesizeStream` buffers before wrapping —
      extracted that WAV-header logic to `shared/utils/wav.ts` so both
      share it), but **not** as one giant segment for the whole turn.
      **Found and fixed the same day, via a real user's live test**:
      the first version buffered the ENTIRE turn's audio internally
      and only sent anything after `turn_complete` — so
      `timeToFirstAudioChunkMs` (measuring when Gemini's SDK produced
      its first internal delta) was **not what the user actually
      experienced**; real time-to-first-audio was closer to
      `totalTurnMs`, since nothing reached the client until the whole
      reply had finished generating. A user reported "5-7 seconds for
      a simple hello" despite `timeToFirstAudioChunkMs` logging under
      3 seconds — that mismatch is exactly this bug. Fixed by flushing
      audio to the client in ~0.8s segments as it arrives
      (`SEGMENT_FLUSH_SECONDS`, `flushAudioSegment`), each its own
      self-contained WAV clip with an incrementing `index` — same
      multi-segment framing Free/Gold already use per sentence, just
      size-boxed instead of sentence-text-boxed (Diamond has no text
      to find sentence breaks in). `timeToFirstAudioChunkMs` is now
      accurate: it's the time to the first segment actually sent.
      Not yet re-verified live with real timing numbers after this
      fix — do that before trusting the metric again (same "verify
      before believing it" pattern as everything else in this phase).
      Wired into `container.ts` (new `container.live: LiveClient`,
      `container.agentContext.{builder,windowBuilder}`,
      `container.services.{conversationWindow,memory}`) and
      `realtime.gateway.ts` (constructed alongside Free/Gold, passed
      into `RealtimeService`'s now 3-pipeline constructor).
- [x] System instructions built once per Live session
      (`diamond-system-instruction.ts`) from `ContextBuilder.build()` +
      `ContextWindowBuilder.build()` — the same builders Free/Gold's
      response step uses, called independently of the planner. Includes
      the persona base prompt, the tool-usage note, the "kundali"
      acknowledgment-filler instructions (decided earlier in this
      phase), conversation summary/recent messages/resume notes, and
      birth/partner profile JSON. Memories are empty (see the RAG/
      memory bullet above).
- [x] **App transport confirmed exactly as hoped**: `endAudioTurn()`
      closes out a turn on demand, so Diamond reuses Free/Gold's exact
      push-to-talk `audio:start`/binary frame(s)/`audio:end` protocol —
      live-verified end-to-end through the real `/ws` gateway with zero
      app-side or gateway-protocol changes. No continuous-streaming
      mode needed.
- [x] Conversation persistence wired: `ConversationWindowService.recordUserTurn`/
      `recordAssistantTurn` called with the turn's final input/output
      transcript once `turn_complete` arrives, then fire-and-forget
      `maybeSummarize` — same pattern `AgentOrchestrator` already uses
      for Free/Gold, called directly since Diamond has no orchestrator
      step of its own. Live-verified: a real turn persisted correctly.
- [x] Memory extraction wired: fire-and-forget `MemoryService.extractAndStore`
      after a completed turn, same pattern/call shape as Free/Gold.
- [ ] Re-apply the English/Hindi-only output restriction. The base
      system prompt's rule 13 asks for it, but there's no server-side
      enforcement point left the way `SentenceSynthesizer` gates
      Free/Gold's TTS input today — Diamond's audio comes straight from
      the model with nothing to intercept. Prompt-only for now, same
      "soft first" pattern as the acknowledgment-filler decision above;
      revisit if live testing shows the model actually drifting
      language.
- [ ] Re-apply the Hindi transcript display-translation behavior for
      the "You said: ..." UI text — `audio:transcribed`'s payload is
      today's raw Live transcript text, not run through
      `DisplayTranslator` the way Free/Gold's is.
- [x] Timing instrumentation added: `timeToFirstAudioChunkMs`/
      `totalTurnMs` logged per turn (`"Realtime audio turn latency
      (diamond)"`), mirroring Free/Gold's existing latency logs.
- [ ] **Live latency test against Free/Gold — only one real turn run
      so far** (see below), not enough yet to draw the same kind of
      conclusion Phase C reached for Gold. Needs a few more real runs,
      ideally one with a cache-cold MCP call and one with a cache-hit,
      before writing anything definitive here.

**First real end-to-end Diamond turn** (2026-09-22, through the actual
`/ws` gateway, a real dev user with a real birth profile, a real MCP
tool call against the live astrology server — not a synthetic unit
test): `timeToFirstAudioChunkMs: 3026`, `totalTurnMs: 17437`, one
`planets` tool call resolved and executed in ~130ms. For comparison,
Gold's two live runs (Phase C table above) landed
`timeToFirstAudioChunkMs` around 5-6s and `totalTurnMs` around 13-19s
— so Diamond's first-audio latency looks meaningfully better here, but
one run each (no tool call in the Gold runs vs. one in this Diamond
run) isn't a fair enough comparison to conclude anything yet.

---

## Explicitly out of scope for this roadmap

- The actual billing/subscription purchase flow, plan upgrade/
  downgrade UX, and payment provider integration.
- Per-tier voice/quality differentiation as a product choice (e.g.
  should Diamond sound different from Free) — a product decision to
  make separately, not an engineering task tracked here.
- Per-tier rate limiting or abuse prevention beyond what already
  exists (`CHAT_RATE_LIMIT_PER_MINUTE`) — worth a follow-up once
  real usage patterns per tier are known, not before.
