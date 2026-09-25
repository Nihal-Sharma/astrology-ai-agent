# Free Tier — Voice Pipeline

The baseline cascade: separate STT, planner, MCP/RAG/memory execution, response
generation, and sentence-by-sentence TTS. Slowest tier by design — every step is
a distinct network call, each paying its own latency.

Entry point: `FreeVoicePipeline` (`server/src/modules/realtime/pipelines/free-voice.pipeline.ts`).

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

    subgraph FREE["FreeVoicePipeline"]
        F1["GeminiSttClient.transcribe(audio)"]
        F2["AgentOrchestrator.runTextTurn(transcript)"]
        F3["ContextBuilder.build:\nbirth profile, partner profile,\nrecent conversation, memories"]
        F4["PlannerService.createPlan:\nLLM routing decision\n(personaMode, responseMode,\nmcp/rag/memory needs)"]
        F5{"Plan requires..."}
        F6["AstrologyService.executeTools"]
        F7["RAGService.retrieve"]
        F8["MemoryService.retrieve"]
        F9["ResponseService:\nstreaming LLM reply (text deltas)"]
        F10["SentenceSynthesizer:\nGeminiTtsClient per sentence"]
    end

    subgraph EXT["External services"]
        E1[("Gemini STT")]
        E2[("Gemini LLM\n(planner + response)")]
        E3[("Astrology MCP server")]
        E4[("Gemini TTS")]
    end

    subgraph PERSIST["Fire-and-forget, after reply completes"]
        P1["ConversationWindowService:\nrecord turn + rolling summary"]
        P2["MemoryService.extractAndStore"]
    end

    A1 --> G1 --> G2 --> F1
    F1 <--> E1
    F1 --> F2 --> F3 --> F4
    F4 <--> E2
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

1. **App records and uploads** — push-to-talk. `audio:start {format:"m4a"}`,
   the full recording as one or more binary WS frames, `audio:end`. The
   gateway buffers the frames and hands the complete `.m4a` blob to
   `RealtimeService.processAudio`.
2. **STT** — `GeminiSttClient.transcribe()` uploads the audio and gets back
   text. This is a full network round trip before anything else can start.
3. **Planner** — `PlannerService.createPlan()` sends the transcript (plus
   conversation context) to the LLM, which returns a structured decision:
   which persona mode to use, whether to call MCP astrology tools, RAG
   knowledge retrieval, or memory search, and which specific tools/queries.
4. **Parallel execution** — whatever the plan asked for runs concurrently:
   `AstrologyService.executeTools` (real MCP calls, birth-profile arguments
   resolved server-side), `RAGService.retrieve`, `MemoryService.retrieve`.
5. **Response generation** — `ResponseService` streams the LLM's reply as
   text deltas, assembled from the planner's decision plus whatever MCP/RAG/
   memory results came back.
6. **Sentence-by-sentence TTS** — as soon as a complete sentence appears in
   the streamed text, `SentenceSynthesizer` sends it to `GeminiTtsClient`
   and streams the resulting WAV audio back to the client immediately,
   framed with `audio:sentence_start`/binary/`audio:sentence_end` — the
   client starts playing the first sentence while later ones are still being
   synthesized, instead of waiting for the whole reply.
7. **Persistence (non-blocking)** — after the reply is fully sent,
   `ConversationWindowService` records both turns and (if the backlog is big
   enough) rolls old messages into a summary; `MemoryService.extractAndStore`
   pulls out any new memorable facts. Neither blocks the user hearing the
   reply.

## Key characteristics

- Every step is a separate network call — STT, planner, response, TTS (one
  call per sentence) — so per-step latency stacks up.
- Hindi transcript shown to the user is cleaned up via `DisplayTranslator`
  before `audio:transcribed` is sent, run concurrently with the agent turn
  continuing (not blocking).
- Fully live-verified and stable — this is the original, longest-running
  tier in this codebase.
