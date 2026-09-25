# 25 Sept 2026 — Where we are, and the steps to a complete live astrology / friend agent

Snapshot taken from ROADMAP.md, free-flow.md, gold-flow.md, Diamond-flow.md,
README.md, PRIVACY.md and a read of the repo. "Done" means documented and
present in code; the tests and the app were not re-run for this note.

Same rule as ROADMAP.md: a step is only checked off (`- [x]`) once it is
**verified live**, not just written or typechecked.

---

## Step 0 — What is already done (no action, for reference)

- [x] **Backend foundation** — Fastify + TypeScript + Mongo, JWT auth (phone+OTP,
      email/password), ownership guards, user / birth-profile / partner-profile
      CRUD, cascade account delete, offline timezone lookup, health / ready /
      metrics, tracing, per-user turn rate limit.
- [x] **Agent brain** — planner → MCP / RAG / memory → streaming response;
      companion / astrologer / blended personas; persisted conversations with
      rolling summarization; long-term memory (extract, embed, retrieve,
      consolidate); astrology MCP with Redis cache and server-side birth-profile
      argument resolution.
- [x] **Voice tiers** — plan routing at WebSocket connect; Free and Gold
      live-verified; Diamond (Gemini Live speech-to-speech) built and
      live-verified, including astrology tool calls and `recall_user_memory`.
- [x] **Mobile app** — phone → OTP → name → birth profile → push-to-talk home
      screen, per-sentence playback, reconnect, plan badge.
- [x] **Tests** — 13 test files including a real Mongo + WebSocket e2e
      (roadmap reports 93 passing at last count).

---

## Step 1 — Lock in Phase D (commit and test it)

Nothing from Diamond is committed, and the new code has no tests.

- [x] Commit the working tree: `server/src/infrastructure/live/`,
      `diamond-voice.pipeline.ts`, `diamond-system-instruction.ts`,
      `audio-transcode.ts`, `wav.ts`, the modified config / container / gateway /
      service / TTS client, `package.json` + lockfile, the three flow docs,
      ROADMAP.md. (Committed as `ae7051f`.)
- [x] Add tests for `audio-transcode.ts` (real ffmpeg, no mock), `wav.ts`, and
      `gemini-live.client.ts` (SDK mocked: option mapping, event bridging,
      connect timeout, session commands) — `wav.test.ts`,
      `audio-transcode.test.ts`, `gemini-live.client.test.ts`.
- [x] Add a `DiamondVoicePipeline` test with a scripted fake Live session
      (`diamond-voice.pipeline.test.ts`, 39 tests): turn protocol, audio pacing
      and `endAudioTurn` ordering, segment flushing and streaming-before-
      `turn_complete`, astrology and `recall_user_memory` tool round trips,
      session reuse / per-connection isolation / conversation switch,
      `dispose()`, persistence, hard-error failure paths, cancellation.
- [x] Run the full suite: **17 files, 161 passing, 3 todo**; typecheck clean.
- [x] **Bug found and fixed while writing these:** `decodeToPcm16` had no
      `stdin` error handler. A large non-audio upload makes ffmpeg exit before
      reading it all, the pending write emits EPIPE/EOF, and `server.ts` turns
      any uncaught exception into `process.exit(1)` — one bad upload from a
      Diamond user would have crashed the whole server. Fixed in
      `audio-transcode.ts`; regression test confirmed to fail without the fix.
      **Not yet committed** (made after the Phase D commit).
- [x] Mutation-checked the pipeline tests: 5 deliberate breakages (no pacing,
      1s segments, no `endAudioTurn`, wrong memory top-K, tool result never
      sent) were each caught.

**Done when:** committed, suite passes, Diamond has at least one automated test.
**Status: done.** Only the `audio-transcode.ts` fix + the four new test files
are left to commit.

## Step 2 — Finish Diamond

The open items from ROADMAP Phase D, plus one gap the docs never mention.

- [ ] **RAG tool** — expose `RAGService.retrieve` as a Live tool (same pattern as
      `recall_user_memory`). Depends on Step 6 having content to retrieve.
- [ ] **English / Hindi enforcement** — decide the mechanism (prompt-only so far;
      Live gives no TTS-input interception point). Live-test whether the model
      drifts before adding anything heavier.
- [ ] **Hindi transcript display-translation** — run the Live transcript through
      `DisplayTranslator` before `audio:transcribed`, concurrently, so it never
      blocks audio.
- [ ] **Three gaps found by Step 1's tests** (recorded as `it.todo` in
      `diamond-voice.pipeline.test.ts`; turn each into a real test + fix):
      1. **Orphaned Live sessions** — `invalidateSession` only deletes the map
         entry, it never calls `close()`. A decode failure (bad upload) drops a
         perfectly healthy session without closing it, leaving an open, billed
         Live connection until Google times it out.
      2. **Dropped early events** — `LiveSession.events()` uses `events.on()`,
         which only listens once iteration starts, and the pipeline starts
         iterating only after `sendAudioPaced` finishes. Anything the server
         emits while audio is still being sent (e.g. early input-transcript
         deltas) is lost. Fix: buffer events from connect, not from first
         iteration.
      3. **Stale events after a cancel** — a cancelled turn leaves the model
         still generating; its leftover audio / `turn_complete` arrive during
         the *next* turn on the same session. Needs draining or turn-tagging.
         Must be solved before barge-in (Step 3).
- [ ] **Session limits and drops** — find out Live's session-length limit and
      what happens when it is hit or the socket drops mid-conversation. Handle
      it (reconnect and rebuild from the conversation window, or resume).
- [ ] **Persona switching** — persona is fixed at connect
      (`previousPersonaMode ?? "blended"`); decide if mid-session switching is
      needed.
- [ ] **Latency runs** — several real turns: one MCP cache-cold, one cache-hit,
      one plain chat, plus a same-day Free and Gold run for a fair comparison.
      Confirm `timeToFirstAudioChunkMs` is accurate after the segment-flush fix.
- [ ] **Acknowledgment filler** — count how often the model skips the "let me
      check your kundali" line before a tool call; build the hard fallback only
      if it matters.
- [ ] **Cost** — measure Live per-minute billing on the account.

**Done when:** each item above is live-tested and ticked in ROADMAP Phase D.

## Step 3 — Make the app feel like a friend

- [ ] **Hands-free / continuous mode** — no need to hold the button. Diamond's
      `endAudioTurn()` makes push-to-talk work, but continuous input is the
      natural fit.
- [ ] **Barge-in** — user can interrupt while the agent is speaking (stop
      playback, cancel the turn, start listening).
- [ ] **Check Diamond's 3-second segments on the app's playback queue** for
      audible gaps between clips (verified through the gateway, not
      specifically on-device).
- [ ] **Text chat** — wire `chat:send` into the app.
- [ ] **Conversation history screen.**
- [ ] **Partner profile UI** — the server supports it; `app/src/api/` has no
      partner-profile client, so compatibility questions can't use it from the
      app yet.

**Done when:** a real device session can be run hands-free, interrupted, and
resumed from history.

## Step 4 — Safety layer

No safety handling found in `server/src` (searched for moderation, crisis,
self-harm, disclaimer, medical and similar terms; nothing in the response
prompt).

- [ ] Crisis / self-harm handling in companion mode: detect, respond with care
      and resources, and do not continue the normal persona reply.
- [ ] Guardrails for health, legal, financial and relationship-decision
      questions ("not professional advice", no fatalistic predictions).
- [ ] Decide where it lives per tier: planner / response prompt for Free and
      Gold; system instruction (and possibly a server-side check on the
      transcript) for Diamond, where there is no planner.
- [ ] Add tests with representative prompts.

**Done when:** a set of sensitive test prompts behaves correctly in all three
tiers.

## Step 5 — Production readiness

- [ ] **Real OTP** — replace the hardcoded `1234` (`STATIC_OTP` in
      `auth.service.ts`) with an SMS provider and OTP expiry / attempt limits.
- [ ] **Billing / plan purchase** — currently out of scope; plans are set by
      `scripts/set-user-plan.ts`. Needed before charging anyone.
- [ ] **Per-tier rate limiting and cost guard** — especially Diamond.
- [ ] **Retention policy and data export** — PRIVACY.md lists both as gaps.
- [ ] **Deploy and CI** — no Dockerfile, CI or deploy config found at the repo
      root (`server/` not checked). Restrict `/metrics` at the infra level.
- [ ] **Secrets** — rotate and store outside the repo, per PRIVACY.md.

**Done when:** a new user can sign up with a real OTP, pay for a plan, and use
it on a deployed environment.

## Step 6 — Populate the knowledge base (RAG)

- [ ] Decide the content source and card format for astrology interpretations.
- [ ] Replace the 5-line placeholder `scripts/seed-knowledge-cards.ts` with a
      real seeder.
- [ ] Seed, then verify retrieval quality on real questions in Free / Gold.
- [ ] Then wire Diamond's RAG tool (Step 2).

**Done when:** RAG-mode turns return grounded, relevant cards.

## Step 7 — Free / Gold latency (only if those tiers stay in the product)

Measured ~20s+ per turn. Gold is not meaningfully faster than Free.

- [ ] **TTS fixed cost** — about 4.5-6.7s per call regardless of length. Test
      other TTS models / voices, or batch sentences.
- [ ] **Response generation** — 17-19s for about 77 characters. Investigate the
      model choice, prompt size, and time to first token.
- [ ] Re-measure Free and Gold side by side after each change.

**Done when:** Free / Gold numbers are recorded before and after, and the gap
between tiers is a deliberate product decision.

## Step 8 — Proactive "friend" features (after the core is solid)

- [ ] Daily horoscope / transit push notifications.
- [ ] Check-ins based on remembered events (memory already stores life events).
- [ ] Decide the notification provider and opt-in flow.

## Step 9 — Docs cleanup

- [ ] ROADMAP.md says Diamond segments are about 0.8s; code and
      Diamond-flow.md say 3s (`SEGMENT_FLUSH_SECONDS = 3`). Fix the roadmap.
- [ ] README says OpenAI drives LLM / STT / TTS and that text chat isn't wired
      into the app; it also doesn't describe the tiers or Diamond. Update it.
- [ ] Keep the "tests" numbers in the roadmap current.

---

## Suggested order

1 → 2 → 3 → 4 → 5, with 6 in parallel with 2–3 (Diamond's RAG tool needs
content). Steps 7–9 after that.
