import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/*
 * ffmpeg is the one thing mocked at the module level — decoding real
 * .m4a is covered by audio-transcode.test.ts, and here it would only
 * add process-spawn latency to every turn.
 */
vi.mock("../../src/shared/utils/audio-transcode", () => ({
  LIVE_INPUT_SAMPLE_RATE_HZ: 16000,
  decodeToPcm16: vi.fn(),
}));

import {
  DiamondVoicePipeline,
} from "../../src/modules/realtime/pipelines/diamond-voice.pipeline";

import {
  buildDiamondSystemInstruction,
} from "../../src/modules/realtime/pipelines/diamond-system-instruction";

import {
  decodeToPcm16,
} from "../../src/shared/utils/audio-transcode";

import type {
  LiveSession,
  LiveSessionEvent,
} from "../../src/infrastructure/live";

import type {
  RealtimeSessionContext,
} from "../../src/modules/realtime/realtime.types";

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A scripted `LiveSession`: each `events()` call (one per turn)
 * replays the next entry of `turns`, appending to a shared log so
 * tests can assert on ORDER across "what the pipeline sent" and
 * "what the model produced" — the tool-call round trip and the
 * send-audio-then-endAudioTurn contract are both ordering claims.
 */
class FakeLiveSession implements LiveSession {
  sentChunks: Array<{
    data: Buffer;
    mimeType: string;
    at: number;
  }> = [];

  toolResults: Array<{
    id: string;
    name: string;
    output: unknown;
  }> = [];

  closed = false;

  constructor(
    private readonly turns: LiveSessionEvent[][],
    readonly log: string[]
  ) {}

  sendAudioChunk(data: Buffer, mimeType: string): void {
    this.sentChunks.push({
      data,
      mimeType,
      at: performance.now(),
    });

    this.log.push("chunk");
  }

  endAudioTurn(): void {
    this.log.push("end");
  }

  sendToolResult(
    id: string,
    name: string,
    output: unknown
  ): void {
    this.toolResults.push({ id, name, output });

    this.log.push(`result:${name}`);
  }

  events(): AsyncIterable<LiveSessionEvent> {
    const script = this.turns.shift() ?? [];

    const log = this.log;

    return (async function* () {
      for (const event of script) {
        log.push(`event:${event.type}`);

        yield event;
      }
    })();
  }

  close(): void {
    this.closed = true;
  }
}

const BIRTH = { placeOfBirth: "Jaipur" };

const PARTNER = { name: "Riya", placeOfBirth: "Delhi" };

const pcm = (bytes: number) => Buffer.alloc(bytes, 1);

interface HarnessOptions {
  /** One entry per Live *connection*; each holds one script per turn. */
  connections?: LiveSessionEvent[][][];

  connectError?: Error;

  partnerProfile?: unknown;

  previousPersonaMode?: string;
}

function makeHarness(options: HarnessOptions = {}) {
  const log: string[] = [];

  const connections = options.connections ?? [[[]]];

  const liveSessions: FakeLiveSession[] = [];

  const liveClient = {
    connect: vi.fn(async () => {
      if (options.connectError) {
        throw options.connectError;
      }

      const script = connections[liveSessions.length];

      const session = new FakeLiveSession(script ?? [[]], log);

      liveSessions.push(session);

      return session;
    }),
  };

  const window = {
    userId: "user-1",
    conversationId: "conv-1",
    currentMessage: "",
    inputType: "voice" as const,
    recentMessages: [
      { role: "user", content: "earlier hello" },
    ],
    birthProfile: BIRTH,
  };

  const contextBuilder = {
    build: vi.fn(async () => ({
      birthProfile: BIRTH,
      partnerProfile: options.partnerProfile ?? null,
      previousPersonaMode: options.previousPersonaMode,
    })),
  };

  const contextWindowBuilder = {
    build: vi.fn(() => window),
  };

  const astrologyService = {
    executeTools: vi.fn(async () => [
      {
        success: true,
        content: { sun: "Gemini" },
      },
    ]),
  };

  const astrologyToolRegistry = {
    getEnabled: vi.fn(() => [
      { name: "planets", description: "Planet positions" },
      { name: "dasha", description: undefined },
    ]),
  };

  const conversationWindowService = {
    recordUserTurn: vi.fn(async () => {}),
    recordAssistantTurn: vi.fn(async () => {}),
    maybeSummarize: vi.fn(async () => {}),
  };

  const memory = {
    extractAndStore: vi.fn(async () => {}),
    retrieve: vi.fn(async () => [
      {
        id: "m1",
        content: "Favorite color is purple",
        category: "preference",
        relevanceScore: 0.9,
      },
    ]),
  };

  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  const pipeline = new DiamondVoicePipeline({
    liveClient: liveClient as any,
    liveModel: "test-live-model",
    liveVoice: "Kore",
    astrologyService: astrologyService as any,
    astrologyToolRegistry: astrologyToolRegistry as any,
    contextBuilder: contextBuilder as any,
    contextWindowBuilder: contextWindowBuilder as any,
    conversationWindowService: conversationWindowService as any,
    memory,
    logger: logger as any,
  });

  return {
    pipeline,
    log,
    liveClient,
    liveSessions,
    window,
    contextBuilder,
    contextWindowBuilder,
    astrologyService,
    astrologyToolRegistry,
    conversationWindowService,
    memory,
    logger,
  };
}

function makeSession(
  overrides: Partial<RealtimeSessionContext> = {}
): RealtimeSessionContext {
  return {
    sessionId: "sess-1",
    userId: "user-1",
    conversationId: "conv-1",
    plan: "diamond",
    ...overrides,
  };
}

async function run(
  pipeline: DiamondVoicePipeline,
  session: RealtimeSessionContext,
  controller = new AbortController()
) {
  const out: any[] = [];

  for await (const message of pipeline.processAudio(
    session,
    {
      requestId: "req-1",
      audio: Buffer.from("fake-m4a"),
      format: "m4a",
    },
    controller
  )) {
    out.push(message);
  }

  return out;
}

const kinds = (out: any[]) =>
  out.map((m) => (Buffer.isBuffer(m) ? "<wav>" : m.type));

/** A minimal complete turn: user speech in, audio + transcript out. */
const simpleTurn = (): LiveSessionEvent[] => [
  { type: "input_transcript", text: "What is my ", final: false },
  { type: "input_transcript", text: "sun sign?", final: true },
  { type: "output_transcript", text: "You are ", final: false },
  {
    type: "audio_chunk",
    data: pcm(1000),
    mimeType: "audio/pcm;rate=24000",
  },
  { type: "output_transcript", text: "a Gemini.", final: true },
  { type: "turn_complete" },
];

beforeEach(() => {
  vi.mocked(decodeToPcm16).mockReset();

  // Three chunks' worth: 4096 + 4096 + 100.
  vi.mocked(decodeToPcm16).mockResolvedValue(
    pcm(4096 * 2 + 100)
  );
});

/* -------------------------------------------------------------------------- */
/* Turn protocol                                                               */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — a normal turn", () => {
  it("emits transcribed → sentence_start → wav → sentence_end → completed", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    const out = await run(h.pipeline, makeSession());

    expect(kinds(out)).toEqual([
      "audio:transcribed",
      "audio:sentence_start",
      "<wav>",
      "audio:sentence_end",
      "audio:completed",
    ]);

    expect(out[0].payload).toEqual({ text: "What is my sun sign?" });
    expect(out[1].payload).toEqual({ index: 0 });
    expect(out[3].payload).toEqual({ index: 0 });
    expect(out.every((m) => Buffer.isBuffer(m) || m.requestId === "req-1")).toBe(true);
  });

  it("emits audio:transcribed at most once, even if several transcript events are final", async () => {
    const h = makeHarness({
      connections: [
        [
          [
            { type: "input_transcript", text: "a", final: true },
            { type: "input_transcript", text: "b", final: true },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    const out = await run(h.pipeline, makeSession());

    expect(
      kinds(out).filter((k) => k === "audio:transcribed")
    ).toHaveLength(1);
  });

  it("wraps model audio as a self-contained WAV at the rate the model reports", async () => {
    const h = makeHarness({
      connections: [
        [
          [
            {
              type: "audio_chunk",
              data: pcm(1000),
              mimeType: "audio/pcm;rate=24000",
            },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    const out = await run(h.pipeline, makeSession());

    const wav = out.find(Buffer.isBuffer) as Buffer;

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(40)).toBe(1000); // data length
  });

  it("uses the rate from the chunk's mime type when it differs, and falls back to 24kHz when absent", async () => {
    const withRate = makeHarness({
      connections: [
        [
          [
            {
              type: "audio_chunk",
              data: pcm(100),
              mimeType: "audio/pcm;rate=16000",
            },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    const noRate = makeHarness({
      connections: [
        [
          [
            { type: "audio_chunk", data: pcm(100), mimeType: "audio/pcm" },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    const a = (await run(withRate.pipeline, makeSession())).find(Buffer.isBuffer) as Buffer;
    const b = (await run(noRate.pipeline, makeSession())).find(Buffer.isBuffer) as Buffer;

    expect(a.readUInt32LE(24)).toBe(16000);
    expect(b.readUInt32LE(24)).toBe(24000);
  });

  it("still completes a turn where the model produced no audio", async () => {
    const h = makeHarness({
      connections: [[[{ type: "turn_complete" }]]],
    });

    const out = await run(h.pipeline, makeSession());

    expect(kinds(out)).toEqual(["audio:completed"]);
  });

  it("logs first-audio and total latency for a turn with audio", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    expect(h.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        timeToFirstAudioChunkMs: expect.any(Number),
        totalTurnMs: expect.any(Number),
      }),
      "Realtime audio turn latency (diamond)"
    );
  });
});

describe("DiamondVoicePipeline — sending the user's audio", () => {
  it("sends 4096-byte 16kHz PCM chunks, then ends the audio turn, then reads events", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    const [live] = h.liveSessions;

    expect(live.sentChunks.map((c) => c.data.length)).toEqual([
      4096, 4096, 100,
    ]);

    expect(
      live.sentChunks.every(
        (c) => c.mimeType === "audio/pcm;rate=16000"
      )
    ).toBe(true);

    // endAudioTurn strictly after every chunk, and before the first event.
    expect(h.log.slice(0, 5)).toEqual([
      "chunk",
      "chunk",
      "chunk",
      "end",
      "event:input_transcript",
    ]);
  });

  it("decodes the uploaded container before it reaches the Live session", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    expect(decodeToPcm16).toHaveBeenCalledWith(Buffer.from("fake-m4a"));
  });

  it("paces chunks rather than bursting them (a burst silently hangs the real API)", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    const times = h.liveSessions[0].sentChunks.map((c) => c.at);

    for (let i = 1; i < times.length; i += 1) {
      // Real delay is 20ms; the lower bound is loose on purpose so
      // timer granularity can't make this flaky, while a synchronous
      // burst (~0ms) still fails it.
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(10);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Audio segmentation                                                          */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — audio segmentation", () => {
  it("flushes a segment once ~3s of audio has accumulated and starts the next one", async () => {
    // 24kHz * 2 bytes * 3s = 144_000-byte threshold.
    const h = makeHarness({
      connections: [
        [
          [
            { type: "audio_chunk", data: pcm(100_000), mimeType: "audio/pcm;rate=24000" },
            { type: "audio_chunk", data: pcm(100_000), mimeType: "audio/pcm;rate=24000" },
            { type: "audio_chunk", data: pcm(50_000), mimeType: "audio/pcm;rate=24000" },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    const out = await run(h.pipeline, makeSession());

    expect(kinds(out)).toEqual([
      "audio:sentence_start",
      "<wav>",
      "audio:sentence_end",
      "audio:sentence_start",
      "<wav>",
      "audio:sentence_end",
      "audio:completed",
    ]);

    const starts = out.filter((m) => m.type === "audio:sentence_start");
    const ends = out.filter((m) => m.type === "audio:sentence_end");
    const wavs = out.filter(Buffer.isBuffer) as Buffer[];

    expect(starts.map((m) => m.payload.index)).toEqual([0, 1]);
    expect(ends.map((m) => m.payload.index)).toEqual([0, 1]);

    // Segment 0 = first two chunks, segment 1 = the remainder.
    expect(wavs.map((w) => w.readUInt32LE(40))).toEqual([200_000, 50_000]);
  });

  it("streams audio to the client as it arrives, not after turn_complete", async () => {
    const h = makeHarness({
      connections: [
        [
          [
            { type: "audio_chunk", data: pcm(150_000), mimeType: "audio/pcm;rate=24000" },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    let turnCompleteSeenWhenWavArrived: boolean | undefined;

    for await (const message of h.pipeline.processAudio(
      makeSession(),
      { requestId: "req-1", audio: Buffer.from("x") },
      new AbortController()
    )) {
      if (Buffer.isBuffer(message)) {
        turnCompleteSeenWhenWavArrived = h.log.includes(
          "event:turn_complete"
        );
      }
    }

    // Regression: the first version buffered the whole turn, so the
    // client got nothing until the model had finished generating.
    expect(turnCompleteSeenWhenWavArrived).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Tools                                                                       */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — astrology tool calls", () => {
  const toolTurn = (calls: any[]): LiveSessionEvent[] => [
    { type: "input_transcript", text: "planets please", final: true },
    { type: "tool_call", calls },
    {
      type: "audio_chunk",
      data: pcm(500),
      mimeType: "audio/pcm;rate=24000",
    },
    { type: "output_transcript", text: "Sun in Gemini.", final: true },
    { type: "turn_complete" },
  ];

  it("runs the tool server-side with the stored birth profile and replies before the model resumes", async () => {
    const h = makeHarness({
      connections: [
        [toolTurn([{ id: "c1", name: "planets", args: { foo: 1 } }])],
      ],
    });

    const controller = new AbortController();

    await run(h.pipeline, makeSession(), controller);

    expect(h.astrologyService.executeTools).toHaveBeenCalledTimes(1);

    expect(h.astrologyService.executeTools).toHaveBeenCalledWith(
      ["planets"],
      expect.objectContaining({
        userId: "user-1",
        conversationId: "conv-1",
        message: "planets please",
        birthProfile: BIRTH,
        partner: undefined,
        extras: { foo: 1 },
        signal: controller.signal,
      })
    );

    expect(h.liveSessions[0].toolResults).toEqual([
      {
        id: "c1",
        name: "planets",
        output: { success: true, content: { sun: "Gemini" } },
      },
    ]);

    // Result goes back before the model's audio arrives.
    expect(h.log.indexOf("result:planets")).toBeGreaterThan(
      h.log.indexOf("event:tool_call")
    );
    expect(h.log.indexOf("result:planets")).toBeLessThan(
      h.log.indexOf("event:audio_chunk")
    );
  });

  it("passes the conversation's partner profile through for compatibility questions", async () => {
    const h = makeHarness({
      partnerProfile: PARTNER,
      connections: [
        [toolTurn([{ id: "c1", name: "matchmaking", args: {} }])],
      ],
    });

    await run(h.pipeline, makeSession());

    expect(h.astrologyService.executeTools).toHaveBeenCalledWith(
      ["matchmaking"],
      expect.objectContaining({
        partner: { birthProfile: PARTNER, name: "Riya" },
      })
    );
  });

  it("answers several calls from one event, in order", async () => {
    const h = makeHarness({
      connections: [
        [
          toolTurn([
            { id: "c1", name: "planets", args: {} },
            { id: "c2", name: "dasha", args: {} },
          ]),
        ],
      ],
    });

    await run(h.pipeline, makeSession());

    expect(
      h.liveSessions[0].toolResults.map((r) => `${r.id}:${r.name}`)
    ).toEqual(["c1:planets", "c2:dasha"]);
  });

  it("returns a failure result — and still finishes the turn — when the tool throws", async () => {
    const h = makeHarness({
      connections: [
        [toolTurn([{ id: "c1", name: "planets", args: {} }])],
      ],
    });

    h.astrologyService.executeTools.mockRejectedValueOnce(
      new Error("mcp down")
    );

    const out = await run(h.pipeline, makeSession());

    expect(h.liveSessions[0].toolResults[0].output).toEqual({
      success: false,
      error: "mcp down",
    });

    expect(kinds(out).at(-1)).toBe("audio:completed");
    expect(h.logger.error).toHaveBeenCalled();
  });

  it("uses a generic message for a non-Error throw, and reports an empty result explicitly", async () => {
    const thrown = makeHarness({
      connections: [
        [toolTurn([{ id: "c1", name: "planets", args: {} }])],
      ],
    });

    thrown.astrologyService.executeTools.mockRejectedValueOnce("boom");

    await run(thrown.pipeline, makeSession());

    expect(thrown.liveSessions[0].toolResults[0].output).toEqual({
      success: false,
      error: "Tool execution failed",
    });

    const empty = makeHarness({
      connections: [
        [toolTurn([{ id: "c1", name: "planets", args: {} }])],
      ],
    });

    empty.astrologyService.executeTools.mockResolvedValueOnce([]);

    await run(empty.pipeline, makeSession());

    expect(empty.liveSessions[0].toolResults[0].output).toEqual({
      success: false,
      error: "Tool produced no result",
    });
  });
});

describe("DiamondVoicePipeline — recall_user_memory", () => {
  const memoryTurn = (args: unknown): LiveSessionEvent[] => [
    {
      type: "tool_call",
      calls: [
        { id: "m1", name: "recall_user_memory", args: args as any },
      ],
    },
    { type: "turn_complete" },
  ];

  it("searches memory with the model's (trimmed) query and returns only content + category", async () => {
    const h = makeHarness({
      connections: [[memoryTurn({ query: "  favourite colour " })]],
    });

    await run(h.pipeline, makeSession());

    expect(h.memory.retrieve).toHaveBeenCalledWith(
      "user-1",
      "favourite colour",
      5
    );

    // Not routed to the astrology service.
    expect(h.astrologyService.executeTools).not.toHaveBeenCalled();

    expect(h.liveSessions[0].toolResults).toEqual([
      {
        id: "m1",
        name: "recall_user_memory",
        output: {
          memories: [
            { content: "Favorite color is purple", category: "preference" },
          ],
        },
      },
    ]);
  });

  it.each([
    ["missing", {}],
    ["blank", { query: "   " }],
    ["not a string", { query: 42 }],
  ])("refuses a %s query without hitting the memory store", async (_label, args) => {
    const h = makeHarness({ connections: [[memoryTurn(args)]] });

    await run(h.pipeline, makeSession());

    expect(h.memory.retrieve).not.toHaveBeenCalled();

    expect(h.liveSessions[0].toolResults[0].output).toEqual({
      memories: [],
      error: "No query supplied",
    });
  });

  it("returns an empty result with the error when retrieval fails, and the turn still completes", async () => {
    const h = makeHarness({
      connections: [[memoryTurn({ query: "job" })]],
    });

    h.memory.retrieve.mockRejectedValueOnce(new Error("mongo down"));

    const out = await run(h.pipeline, makeSession());

    expect(h.liveSessions[0].toolResults[0].output).toEqual({
      memories: [],
      error: "mongo down",
    });

    expect(kinds(out).at(-1)).toBe("audio:completed");
  });
});

/* -------------------------------------------------------------------------- */
/* Session setup                                                               */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — session setup", () => {
  it("connects with the configured model/voice, the built instruction and both tool families", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    expect(h.liveClient.connect).toHaveBeenCalledTimes(1);

    const options = (h.liveClient.connect.mock.calls as any)[0][0];

    expect(options.model).toBe("test-live-model");
    expect(options.voiceName).toBe("Kore");

    // The pieces of context that make it into the instruction.
    expect(options.systemInstruction).toContain("TOOL-CALL ACKNOWLEDGMENTS");
    expect(options.systemInstruction).toContain("Jaipur");
    expect(options.systemInstruction).toContain("earlier hello");

    expect(options.tools).toEqual([
      {
        name: "planets",
        description: "Planet positions",
        // Deliberately empty: the server fills birth details in itself.
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "dasha",
        description: "",
        parameters: { type: "object", properties: {}, required: [] },
      },
      expect.objectContaining({
        name: "recall_user_memory",
        parameters: expect.objectContaining({
          required: ["query"],
        }),
      }),
    ]);
  });

  it("builds context without a user message (there is no text before the model hears the audio)", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    expect(h.contextBuilder.build).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId: "conv-1",
      inputType: "voice",
    });
  });

  it("uses the previous persona mode, defaulting to blended", async () => {
    const remembered = makeHarness({
      previousPersonaMode: "astrologer",
      connections: [[simpleTurn()]],
    });

    await run(remembered.pipeline, makeSession());

    const fresh = makeHarness({ connections: [[simpleTurn()]] });

    await run(fresh.pipeline, makeSession());

    const instruction = (h: typeof fresh) =>
      (h.liveClient.connect.mock.calls as any)[0][0].systemInstruction;

    expect(instruction(remembered)).toBe(
      buildDiamondSystemInstruction(remembered.window as any, "astrologer")
    );

    expect(instruction(fresh)).toBe(
      buildDiamondSystemInstruction(fresh.window as any, "blended")
    );
  });

  it("reuses one Live session across turns on the same connection", async () => {
    const h = makeHarness({
      connections: [[simpleTurn(), simpleTurn()]],
    });

    const session = makeSession();

    await run(h.pipeline, session);
    await run(h.pipeline, session);

    expect(h.liveClient.connect).toHaveBeenCalledTimes(1);
    expect(h.contextBuilder.build).toHaveBeenCalledTimes(1);

    // Both turns' audio went into the same session (3 chunks each).
    expect(h.liveSessions[0].sentChunks).toHaveLength(6);
  });

  it("gives each WebSocket connection its own Live session", async () => {
    const h = makeHarness({
      connections: [[simpleTurn()], [simpleTurn()]],
    });

    await run(h.pipeline, makeSession({ sessionId: "a" }));
    await run(h.pipeline, makeSession({ sessionId: "b" }));

    expect(h.liveClient.connect).toHaveBeenCalledTimes(2);
  });

  it("closes the old session and reconnects when the conversation changes mid-connection", async () => {
    const h = makeHarness({
      connections: [[simpleTurn()], [simpleTurn()]],
    });

    const session = makeSession();

    await run(h.pipeline, session);

    session.conversationId = "conv-2";

    await run(h.pipeline, session);

    expect(h.liveSessions).toHaveLength(2);
    expect(h.liveSessions[0].closed).toBe(true);
    expect(h.liveSessions[1].closed).toBe(false);
  });
});

describe("DiamondVoicePipeline.dispose", () => {
  it("closes the session, and the next turn opens a fresh one", async () => {
    const h = makeHarness({
      connections: [[simpleTurn()], [simpleTurn()]],
    });

    const session = makeSession();

    await run(h.pipeline, session);

    h.pipeline.dispose(session);

    expect(h.liveSessions[0].closed).toBe(true);

    await run(h.pipeline, session);

    expect(h.liveClient.connect).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for a connection that never ran a turn (and safe to call twice)", () => {
    const h = makeHarness();

    const session = makeSession();

    expect(() => h.pipeline.dispose(session)).not.toThrow();
    expect(() => h.pipeline.dispose(session)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — persistence after a turn", () => {
  it("records both turns, then kicks off summarization and memory extraction", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    await run(h.pipeline, makeSession());

    expect(h.conversationWindowService.recordUserTurn).toHaveBeenCalledWith({
      conversationId: "conv-1",
      userId: "user-1",
      message: "What is my sun sign?",
    });

    expect(h.conversationWindowService.recordAssistantTurn).toHaveBeenCalledWith({
      conversationId: "conv-1",
      userId: "user-1",
      message: "You are a Gemini.",
    });

    expect(h.conversationWindowService.maybeSummarize).toHaveBeenCalledWith("conv-1");

    expect(h.memory.extractAndStore).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId: "conv-1",
      userMessage: "What is my sun sign?",
      assistantMessage: "You are a Gemini.",
    });
  });

  it("persists nothing when either transcript is empty", async () => {
    const noUserText = makeHarness({
      connections: [
        [
          [
            { type: "audio_chunk", data: pcm(100), mimeType: "audio/pcm;rate=24000" },
            { type: "output_transcript", text: "hi", final: true },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    await run(noUserText.pipeline, makeSession());

    expect(noUserText.conversationWindowService.recordUserTurn).not.toHaveBeenCalled();
    expect(noUserText.memory.extractAndStore).not.toHaveBeenCalled();
  });

  it("does not fail the turn when fire-and-forget summarization or extraction rejects", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    h.conversationWindowService.maybeSummarize.mockRejectedValueOnce(
      new Error("summarizer down")
    );

    h.memory.extractAndStore.mockRejectedValueOnce(
      new Error("extractor down")
    );

    const out = await run(h.pipeline, makeSession());

    expect(kinds(out).at(-1)).toBe("audio:completed");

    // Let the .catch handlers run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = h.logger.error.mock.calls.map((call) => call[1]);

    expect(messages).toContain(
      "Fire-and-forget summarization failed (diamond)"
    );
    expect(messages).toContain(
      "Fire-and-forget memory extraction failed (diamond)"
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Failure and cancellation                                                    */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — failures (hard-error, no tier downgrade)", () => {
  it("yields audio:error and nothing else when the Live session can't be established", async () => {
    const h = makeHarness({ connectError: new Error("quota exceeded") });

    const out = await run(h.pipeline, makeSession());

    expect(kinds(out)).toEqual(["audio:error"]);
    expect(out[0].payload.message).toBe("quota exceeded");
    expect(h.logger.error).toHaveBeenCalled();

    // Nothing was sent anywhere — no silent fallback to another tier.
    expect(h.astrologyService.executeTools).not.toHaveBeenCalled();
  });

  it("retries connecting on the next turn after a failed connect", async () => {
    const h = makeHarness({ connectError: new Error("quota exceeded") });

    await run(h.pipeline, makeSession());
    await run(h.pipeline, makeSession());

    expect(h.liveClient.connect).toHaveBeenCalledTimes(2);
  });

  it("yields audio:error when the audio can't be decoded", async () => {
    vi.mocked(decodeToPcm16).mockRejectedValueOnce(
      new Error("ffmpeg exited with code 1")
    );

    const h = makeHarness({ connections: [[simpleTurn()]] });

    const out = await run(h.pipeline, makeSession());

    expect(kinds(out)).toEqual(["audio:error"]);
    expect(out[0].payload.message).toMatch(/ffmpeg exited/);
    expect(h.liveSessions[0].sentChunks).toHaveLength(0);
  });

  it("surfaces a Live `error` event and reconnects on the next turn", async () => {
    const h = makeHarness({
      connections: [
        [[{ type: "error", error: new Error("stream reset") }]],
        [simpleTurn()],
      ],
    });

    const session = makeSession();

    const first = await run(h.pipeline, session);

    expect(kinds(first)).toEqual(["audio:error"]);
    expect(first[0].payload.message).toBe("stream reset");

    const second = await run(h.pipeline, session);

    expect(kinds(second).at(-1)).toBe("audio:completed");
    expect(h.liveClient.connect).toHaveBeenCalledTimes(2);
  });

  it("reports an error, keeps partial audio, and reconnects when the session closes mid-turn", async () => {
    const h = makeHarness({
      connections: [
        [
          [
            { type: "audio_chunk", data: pcm(500), mimeType: "audio/pcm;rate=24000" },
            { type: "closed" },
          ],
        ],
        [simpleTurn()],
      ],
    });

    const session = makeSession();

    const first = await run(h.pipeline, session);

    expect(kinds(first)).toEqual([
      "audio:sentence_start",
      "<wav>",
      "audio:sentence_end",
      "audio:error",
    ]);

    expect(first.at(-1).payload.message).toBe(
      "The Live session closed before this turn finished."
    );

    // Nothing persisted for a turn that never completed.
    expect(h.conversationWindowService.recordAssistantTurn).not.toHaveBeenCalled();

    await run(h.pipeline, session);

    expect(h.liveClient.connect).toHaveBeenCalledTimes(2);
  });
});

describe("DiamondVoicePipeline — cancellation", () => {
  it("cancels before sending any audio if aborted while decoding", async () => {
    const h = makeHarness({ connections: [[simpleTurn()]] });

    const controller = new AbortController();

    controller.abort();

    const out = await run(h.pipeline, makeSession(), controller);

    expect(kinds(out)).toEqual(["audio:cancelled"]);
    expect(h.liveSessions[0].sentChunks).toHaveLength(0);
  });

  it("cancels mid-turn: emits audio:cancelled, never audio:completed, persists nothing", async () => {
    const h = makeHarness({
      connections: [
        [
          [
            { type: "input_transcript", text: "hi", final: false },
            { type: "audio_chunk", data: pcm(500), mimeType: "audio/pcm;rate=24000" },
            { type: "output_transcript", text: "hello", final: false },
            { type: "audio_chunk", data: pcm(500), mimeType: "audio/pcm;rate=24000" },
            { type: "turn_complete" },
          ],
        ],
      ],
    });

    const controller = new AbortController();

    const out: any[] = [];

    for await (const message of h.pipeline.processAudio(
      makeSession(),
      { requestId: "req-1", audio: Buffer.from("x") },
      controller
    )) {
      out.push(message);

      if (message.type === "audio:sentence_start") {
        controller.abort();
      }
    }

    expect(kinds(out).at(-1)).toBe("audio:cancelled");
    expect(kinds(out)).not.toContain("audio:completed");
    expect(h.conversationWindowService.recordUserTurn).not.toHaveBeenCalled();
    expect(h.memory.extractAndStore).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Known gaps, found while writing these tests (not yet fixed)                 */
/* -------------------------------------------------------------------------- */

describe("DiamondVoicePipeline — known gaps", () => {
  it.todo(
    "closes a Live session it invalidates — today `invalidateSession` only drops the map entry, so a decode failure (healthy session) leaves the connection open and orphaned"
  );

  it.todo(
    "does not lose Live events emitted while user audio is still being sent — `events()` (events.on) only listens once iteration starts, i.e. after `sendAudioPaced` finishes, so early transcript deltas can be dropped"
  );

  it.todo(
    "does not let a cancelled turn's leftover Live events (audio, turn_complete) leak into the next turn on the same session — matters for barge-in (Step 3)"
  );
});
