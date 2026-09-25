import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * `@google/genai` is mocked so this file exercises OUR wrapper —
 * option mapping, the SDK-callback → async-iterable bridge, the
 * connect-timeout guard — without opening a real Live session.
 * (The real-API behavior is what ROADMAP Phase D's live tests cover;
 * this is the regression net around the code that wraps it.)
 */
const sdk = vi.hoisted(() => {
  const state: {
    connectParams: any;
    connectImpl: (params: any) => Promise<any>;
    rawSession: {
      sendRealtimeInput: ReturnType<typeof vi.fn>;
      sendToolResponse: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  } = {
    connectParams: undefined,
    connectImpl: async () => state.rawSession,
    rawSession: undefined as any,
  };

  return state;
});

vi.mock("@google/genai", () => ({
  Modality: { AUDIO: "AUDIO" },

  GoogleGenAI: class {
    live = {
      connect: (params: any) => {
        sdk.connectParams = params;

        return sdk.connectImpl(params);
      },
    };
  },
}));

import {
  GeminiLiveClient,
} from "../../src/infrastructure/live/gemini-live.client";

import type {
  LiveSessionEvent,
} from "../../src/infrastructure/live";

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as any;

function makeClient() {
  return new GeminiLiveClient({
    apiKey: "test-key",
    logger,
  });
}

const baseOptions = {
  model: "gemini-test-live",
  systemInstruction: "You are a test persona.",
};

/** Default SDK behaviour: open the socket, then resolve with the raw session. */
function connectThatOpens() {
  sdk.connectImpl = async (params) => {
    params.callbacks.onopen();

    return sdk.rawSession;
  };
}

beforeEach(() => {
  sdk.connectParams = undefined;

  sdk.rawSession = {
    sendRealtimeInput: vi.fn(),
    sendToolResponse: vi.fn(),
    close: vi.fn(),
  };

  connectThatOpens();

  logger.debug.mockClear();
  logger.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GeminiLiveClient.connect — option mapping", () => {
  it("requests audio output with both transcription streams and forwards model, instruction and abort signal", async () => {
    const controller = new AbortController();

    await makeClient().connect({
      ...baseOptions,
      signal: controller.signal,
    });

    const { model, config } = sdk.connectParams;

    expect(model).toBe("gemini-test-live");
    expect(config.responseModalities).toEqual(["AUDIO"]);
    expect(config.systemInstruction).toBe("You are a test persona.");
    // Presence (even as `{}`) is what switches each transcription on.
    expect(config.inputAudioTranscription).toEqual({});
    expect(config.outputAudioTranscription).toEqual({});
    expect(config.abortSignal).toBe(controller.signal);
  });

  it("declares tools with parametersJsonSchema (plain JSON Schema), not Gemini's typed `parameters`", async () => {
    const schema = {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    };

    await makeClient().connect({
      ...baseOptions,
      tools: [
        {
          name: "recall_user_memory",
          description: "Search memories",
          parameters: schema,
        },
      ],
    });

    expect(sdk.connectParams.config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "recall_user_memory",
            description: "Search memories",
            parametersJsonSchema: schema,
          },
        ],
      },
    ]);
  });

  it("omits `tools` entirely when none (or an empty list) are given", async () => {
    await makeClient().connect({ ...baseOptions });
    expect(sdk.connectParams.config.tools).toBeUndefined();

    await makeClient().connect({ ...baseOptions, tools: [] });
    expect(sdk.connectParams.config.tools).toBeUndefined();
  });

  it("maps voiceName to a prebuilt voice config, and omits speechConfig without one", async () => {
    await makeClient().connect({ ...baseOptions, voiceName: "Kore" });

    expect(sdk.connectParams.config.speechConfig).toEqual({
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: "Kore" },
      },
    });

    await makeClient().connect({ ...baseOptions });

    expect(sdk.connectParams.config.speechConfig).toBeUndefined();
  });
});

describe("GeminiLiveClient.connect — failure handling", () => {
  it("rejects instead of hanging when the server never completes setup (bad model name)", async () => {
    vi.useFakeTimers();

    // The real SDK gap: this promise never settles.
    sdk.connectImpl = () => new Promise(() => {});

    const assertion = expect(
      makeClient().connect(baseOptions)
    ).rejects.toThrow(/did not open within 15000ms/);

    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
  });

  it("does not time out a connect that succeeds in time", async () => {
    vi.useFakeTimers();

    const session = await makeClient().connect(baseOptions);

    expect(session).toBeDefined();

    // No stray timer left over that would reject later.
    await vi.advanceTimersByTimeAsync(20_000);
  });

  it("propagates an SDK-level connect rejection unchanged", async () => {
    sdk.connectImpl = async () => {
      throw new Error("network down");
    };

    await expect(
      makeClient().connect(baseOptions)
    ).rejects.toThrow("network down");
  });

  it("rejects when the socket errors before the session opens", async () => {
    sdk.connectImpl = async (params) => {
      params.callbacks.onerror({
        message: "bad api key",
        error: new Error("bad api key"),
      });

      return sdk.rawSession;
    };

    await expect(
      makeClient().connect(baseOptions)
    ).rejects.toThrow("bad api key");

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("GeminiLiveClient session events", () => {
  /**
   * `events()` is built on `events.on()`, which only sees emissions
   * that happen AFTER iteration starts — so tests must start
   * collecting first, then drive the SDK callbacks.
   */
  async function openSession() {
    const session = await makeClient().connect(baseOptions);

    const received: LiveSessionEvent[] = [];

    const done = (async () => {
      for await (const event of session.events()) {
        received.push(event);
      }
    })();

    // Let the async generator register its listener.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const callbacks = sdk.connectParams.callbacks;

    return { session, received, done, callbacks };
  }

  it("maps transcripts, honoring the `finished` flag", async () => {
    const { received, done, callbacks } = await openSession();

    callbacks.onmessage({
      serverContent: {
        inputTranscription: { text: "namaste", finished: true },
        outputTranscription: { text: "hello" },
      },
    });

    callbacks.onclose({ code: 1000, reason: "" });

    await done;

    expect(received).toEqual([
      { type: "input_transcript", text: "namaste", final: true },
      { type: "output_transcript", text: "hello", final: false },
      { type: "closed" },
    ]);
  });

  it("decodes base64 audio into a Buffer and defaults the mime type", async () => {
    const { received, done, callbacks } = await openSession();

    const bytes = Buffer.from([10, 20, 30, 40]);

    callbacks.onmessage({
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                data: bytes.toString("base64"),
                mimeType: "audio/pcm;rate=24000",
              },
            },
            { inlineData: { data: bytes.toString("base64") } },
            { text: "no audio in this part" },
          ],
        },
      },
    });

    callbacks.onclose({});

    await done;

    const chunks = received.filter(
      (e) => e.type === "audio_chunk"
    ) as Extract<LiveSessionEvent, { type: "audio_chunk" }>[];

    expect(chunks).toHaveLength(2);
    expect(Buffer.isBuffer(chunks[0].data)).toBe(true);
    expect(chunks[0].data.equals(bytes)).toBe(true);
    expect(chunks[0].mimeType).toBe("audio/pcm;rate=24000");
    expect(chunks[1].mimeType).toBe("audio/pcm");
  });

  it("maps interruption, turn completion and tool calls (defaulting missing id/args)", async () => {
    const { received, done, callbacks } = await openSession();

    callbacks.onmessage({ serverContent: { interrupted: true } });
    callbacks.onmessage({ serverContent: { turnComplete: true } });
    callbacks.onmessage({
      toolCall: {
        functionCalls: [
          { id: "c1", name: "planets", args: { a: 1 } },
          { name: "recall_user_memory" },
        ],
      },
    });
    callbacks.onclose({});

    await done;

    expect(received).toEqual([
      { type: "interrupted" },
      { type: "turn_complete" },
      {
        type: "tool_call",
        calls: [
          { id: "c1", name: "planets", args: { a: 1 } },
          { id: "", name: "recall_user_memory", args: {} },
        ],
      },
      { type: "closed" },
    ]);
  });

  it("fans one server message out into separate events, in a stable order", async () => {
    const { received, done, callbacks } = await openSession();

    callbacks.onmessage({
      serverContent: {
        inputTranscription: { text: "in" },
        outputTranscription: { text: "out" },
        modelTurn: {
          parts: [{ inlineData: { data: "AQID", mimeType: "audio/pcm" } }],
        },
        interrupted: true,
        turnComplete: true,
      },
      toolCall: { functionCalls: [{ id: "x", name: "t", args: {} }] },
    });
    callbacks.onclose({});

    await done;

    expect(received.map((e) => e.type)).toEqual([
      "input_transcript",
      "output_transcript",
      "audio_chunk",
      "interrupted",
      "turn_complete",
      "tool_call",
      "closed",
    ]);
  });

  it("emits nothing for a message with no recognized content (e.g. setup/usage metadata)", async () => {
    const { received, done, callbacks } = await openSession();

    callbacks.onmessage({ setupComplete: {} });
    callbacks.onmessage({ serverContent: {} });
    callbacks.onmessage({
      serverContent: { inputTranscription: { text: "" } },
    });
    callbacks.onclose({});

    await done;

    expect(received).toEqual([{ type: "closed" }]);
  });

  it("surfaces a mid-session socket error as an `error` event", async () => {
    const { received, done, callbacks } = await openSession();

    callbacks.onerror({ message: "quota exceeded", error: new Error("x") });
    callbacks.onerror({ error: new Error("no message") });
    callbacks.onclose({});

    await done;

    const errors = received.filter(
      (e) => e.type === "error"
    ) as Extract<LiveSessionEvent, { type: "error" }>[];

    expect(errors.map((e) => e.error.message)).toEqual([
      "quota exceeded",
      "Live session error",
    ]);
  });

  it("ends the iterator on `closed` and ignores anything emitted afterwards", async () => {
    const { received, done, callbacks } = await openSession();

    callbacks.onclose({ code: 1008, reason: "bad model" });

    // Resolves — i.e. the async iterable terminated.
    await done;

    callbacks.onmessage({ serverContent: { turnComplete: true } });

    expect(received).toEqual([{ type: "closed" }]);
  });
});

describe("GeminiLiveSession commands", () => {
  it("sends audio as base64 realtime input with the given mime type", async () => {
    const session = await makeClient().connect(baseOptions);

    const pcm = Buffer.from([1, 2, 3, 4]);

    session.sendAudioChunk(pcm, "audio/pcm;rate=16000");

    expect(sdk.rawSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: pcm.toString("base64"),
        mimeType: "audio/pcm;rate=16000",
      },
    });
  });

  it("closes a push-to-talk turn with audioStreamEnd", async () => {
    const session = await makeClient().connect(baseOptions);

    session.endAudioTurn();

    expect(sdk.rawSession.sendRealtimeInput).toHaveBeenCalledWith({
      audioStreamEnd: true,
    });
  });

  it("wraps a tool result as { output } inside a functionResponse", async () => {
    const session = await makeClient().connect(baseOptions);

    session.sendToolResult("call-1", "planets", { sun: "Gemini" });

    expect(sdk.rawSession.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [
        {
          id: "call-1",
          name: "planets",
          response: { output: { sun: "Gemini" } },
        },
      ],
    });
  });

  it("closes the underlying session", async () => {
    const session = await makeClient().connect(baseOptions);

    session.close();

    expect(sdk.rawSession.close).toHaveBeenCalledTimes(1);
  });
});
