# Roadmap — Three-Tier Voice Pipeline (Free / Gold / Diamond)

Supersedes the previous single-track latency roadmap. The product
direction changed: instead of migrating everyone to one new
architecture, three tiers coexist permanently, each a genuinely
different pipeline, gated by subscription plan:

| Tier | Pipeline | Speed |
|---|---|---|
| **Free** | Audio → STT → LLM (planner + response) → MCP → TTS | Slowest (today's cascade, already live) |
| **Gold** | Audio → LLM (audio input, no separate STT) → MCP → TTS | Mid |
| **Diamond** | Audio → LLM (Live API, speech-to-speech) → MCP → Audio | Fastest |

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
  billing. Model name candidates seen in the SDK's own examples
  (`gemini-live-2.5-flash-preview`, `gemini-2.0-flash-live-preview-
  04-09`) — **do not trust these as final**; reconfirm against the
  live SDK/docs when Phase D actually starts, the same way
  `gemini-3.1-flash-tts-preview`'s accepted format turned out to
  differ from what any doc excerpt suggested.
- **Gemini audio-input on `generateContent`** (Gold tier) — no new
  service or credential, just a different call shape (an inline
  audio `Part` alongside the text prompt) on the client we already
  have.
- **`react-native-webrtc`** (app only, Diamond tier, conditional) —
  only needed if Diamond's transport decision (see Phase D) picks
  direct client↔Gemini WebRTC over a server-proxied WebSocket.
  Requires a prebuild/rebuild cycle like any native module here.
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
- [ ] **Still not done — needs another live test**: the fix above
      should let a Gold-tier turn get *past* planning, but nothing
      after that point (MCP/RAG execution, response generation, TTS)
      has been observed live yet for this tier — the turn errored
      out at the planner-validation step before reaching any of it.
      Treat everything past this fix as still unverified.
- [ ] **Live-verify transcription accuracy doesn't degrade** when
      the same call is also doing routing — compare tool-selection
      quality against Free tier on the same set of test messages.
- [ ] Measure actual latency win once live — confirm removing STT's
      upload+transcribe round-trip produces a real, meaningful
      improvement over Free tier before calling this tier done.

## Phase D — Diamond tier: Gemini Live API (full speech-to-speech)

The full architectural migration originally scoped as this
project's only plan — now scoped to Diamond-tier users specifically,
not a hard cutover. One persistent model session that listens,
reasons, and speaks in one integrated loop; no separate STT/planner/
TTS calls at all.

- [ ] **Transport decision**: server-proxied WebSocket (app ↔ our
      server ↔ Gemini Live) vs. direct client↔Gemini WebRTC (our
      server only mints a short-lived session token). Proxied keeps
      auth/ownership checks server-side and reuses more of the
      existing `/ws` gateway shape; direct removes a network hop at
      the cost of `react-native-webrtc` and a bigger client rewrite.
- [ ] Confirm actual Live API access/quota/pricing for the account
      before building against it.
- [ ] Decide how the planner/MCP/RAG/memory steps map onto a Live
      session: MCP astrology tools become function calls the model
      invokes mid-conversation (reusing `AstrologyService`/the MCP
      executor underneath, not rebuilt); persona-mode selection and
      RAG/memory retrieval need a new home since there's no separate
      up-front planning step in this model — see this session's
      earlier discussion of that exact tradeoff (persona mode has no
      clean equivalent; either folded into system instructions or a
      lightweight self-reported tool call).
- [ ] New server module wrapping the Live session lifecycle (session
      create, audio in, function-call events, audio out, session
      end) — likely the `DiamondVoicePipeline` from Phase A, or a
      dedicated module it delegates to given how different this
      session model is from the other two.
- [ ] Feed birth profile, persona-mode guidance, and relevant memory
      into the session's system instructions at session start.
- [ ] App: continuous audio streaming instead of push-to-talk
      buffering, for Diamond-tier sessions specifically — Free/Gold
      keep push-to-talk. The client needs to know which mode to run,
      which means it also needs to know the user's plan (from the
      same user-fetch Phase A wires server-side).
- [ ] Re-wire conversation persistence (user/assistant messages,
      rolling summarization) so a Diamond-tier turn still gets
      recorded in Mongo the way cascaded turns do.
- [ ] Re-wire memory extraction/storage for Diamond-tier turns.
- [ ] Re-apply the English/Hindi-only output restriction to whatever
      produces the spoken reply here — today's `isEnglishOrHindi`
      check sits on discrete TTS text input, which won't exist as a
      separate step in this model.
- [ ] Re-apply the Hindi transcript display-translation behavior for
      the "You said: ..." UI text.
- [ ] Add timing instrumentation (a Live-session equivalent of
      today's `sttMs`/`timeToFirstAudioChunkMs` logging) so the
      "fastest" claim is actually measured, not assumed.
- [ ] Live latency test against Free/Gold; record real numbers here
      once available.

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
