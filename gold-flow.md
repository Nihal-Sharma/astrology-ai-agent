# Gold Tier — Voice Pipeline

Skips Free tier's separate STT call: raw audio goes straight into the planner
call, which transcribes AND produces its routing decision in one LLM call.
Everything downstream (MCP/RAG execution, response generation, sentence-by-
sentence TTS) is identical to Free tier's code.

Entry point: `GoldVoicePipeline` (`server/src/modules/realtime/pipelines/gold-voice.pipeline.ts`).

## Data Flow Diagram

```mermaid
flowchart TD
    subgraph APP["App"]
        A1["Record mic audio (.m4a)"]
        A2["Play synthesized reply"]
    end

    subgraph GATEWAY["Server: /ws gateway"]
        G1["audio:start -> buffer binary chunks -> audio:end"]
        G2["RealtimeService.processAudio"]
    end

    subgraph GOLD["GoldVoicePipeline"]
        F2["AgentOrchestrator.runAudioTurn:\naudio passed straight in,\nNO separate STT call"]
        F3["ContextBuilder.build:\nbirth profile, partner profile,\nrecent conversation\n(NO memory search yet -\nno transcript exists)"]
        F4["PlannerService.createPlan(audio):\nONE LLM call does BOTH\ntranscription AND routing decision"]
        F4b["DisplayTranslator:\nHindi transcript cleanup for UI -\nruns CONCURRENTLY with next step,\nnot blocking it"]
        F5{"Plan requires..."}
        F6["AstrologyService.executeTools"]
        F7["RAGService.retrieve"]
        F8["MemoryService.retrieve\n(now possible - transcript is known)"]
        F9["ResponseService:\nstreaming LLM reply (text deltas)"]
        F10["SentenceSynthesizer:\nGeminiTtsClient per sentence"]
    end

    subgraph EXT["External services"]
        E2[("Gemini LLM\n(multimodal audio input)")]
        E3[("Astrology MCP server")]
        E4[("Gemini TTS")]
    end

    subgraph PERSIST["Fire-and-forget, after reply completes"]
        P1["ConversationWindowService:\nrecord turn + rolling summary"]
        P2["MemoryService.extractAndStore"]
    end

    A1 --> G1 --> G2 --> F2
    F2 --> F3 --> F4
    F4 <--> E2
    F4 -->|transcript + plan known| F4b
    F4 --> F5
    F5 -->|mcp| F6 <--> E3
    F5 -->|rag| F7
    F5 -->|memory| F8
    F6 --> F9
    F7 --> F9
    F8 --> F9
    F9 <--> E2
    F9 -->|per sentence boundary| F10
    F10 <--> E4
    F10 -->|"WAV per sentence\n(audio:sentence_start/binary/end)"| G2
    G2 --> A2
    F9 -.-> P1
    F9 -.-> P2
```

## Step by step

1. **App records and uploads** — identical protocol to Free tier:
   `audio:start {format:"m4a"}`, binary frame(s), `audio:end`. No app changes
   between Free and Gold at all.
2. **No separate STT** — the raw `.m4a` bytes are attached as an inline
   `Part` directly to the planner's LLM call (`LlmGenerateInput.audio`,
   `GeminiLlmClient.toContents`). Gemini decodes the container itself.
3. **Combined transcribe + plan** — `PlannerService.createPlan()` returns
   BOTH the transcript (`plan.transcript`) and the routing decision in one
   response. `AgentOrchestrator.runAudioTurn` yields a `{type:"transcript"}`
   event first, which `GoldVoicePipeline` expects as the very first thing out
   of the agent turn.
4. **Context built without a message** — `ContextBuilder.build()` is called
   *before* the transcript exists (audio hasn't been transcribed yet), so it
   runs without a `message` — memory search is skipped at this point
   (`ContextBuilder`'s own contract: no message, no memory query). Memory
   retrieval happens later, once the plan is known and the transcript exists.
5. **Concurrent display-translation** — once the transcript is known,
   `DisplayTranslator` (Hindi cleanup for the `audio:transcribed` UI text)
   runs *at the same time* as the agent turn continues (MCP/RAG execution,
   response generation already starting) — a manual async-iterator priming
   trick, not sequential blocking.
6. **From here on, identical to Free** — parallel MCP/RAG/memory execution,
   streaming response generation, sentence-by-sentence TTS via the same
   `SentenceSynthesizer`, same persistence/memory-extraction fire-and-forget
   calls at the end.

## Key characteristics

- Saves one network round trip (no separate STT call) compared to Free.
- **Live-measured finding (not theoretical)**: in practice, Gold is **not
  meaningfully faster than Free** — see `ROADMAP.md`'s Phase C. TTS's large
  fixed per-call latency and slow response-generation streaming dominate
  total turn time, and both are identical code shared with Free tier. The
  ~1-2s Gold saves on transcription+planning is small next to that.
- Same sentence-by-sentence audio streaming and Hindi/English enforcement as
  Free (shared `SentenceSynthesizer`, `DisplayTranslator`).
