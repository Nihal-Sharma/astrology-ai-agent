import {
  EventEmitter,
  on,
} from "node:events";

import {
  GoogleGenAI,
  Modality,
  LiveServerMessage,
  Session as RawLiveSession,
} from "@google/genai";

import {
  AppLogger,
} from "../observability/logger";

import {
  LiveClient,
  LiveSession,
  LiveSessionEvent,
  LiveSessionOptions,
  LiveToolDeclaration,
} from "./live.types";

export interface GeminiLiveClientOptions {
  apiKey: string;

  logger: AppLogger;
}

/**
 * The underlying SDK's own `live.connect()` promise waits on a
 * server "setupComplete" message that never arrives when setup
 * fails (e.g. an unsupported model name) — confirmed live: the
 * server closes the socket with an error reason, but the SDK never
 * surfaces it, so `connect()` hangs forever instead of rejecting.
 * This is our own guard against that gap.
 */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Gemini (`@google/genai`) implementation of `LiveClient` — see
 * ROADMAP.md's Phase D. Bridges the SDK's callback-based
 * `onmessage`/`onerror`/`onclose` into the async-iterable style
 * every other streaming interface in this codebase already uses
 * (`STTClient.transcribeStream`, `TTSClient.synthesizeStream`,
 * `LlmClient.stream`), via Node's built-in `events.on()` — no
 * hand-rolled queue.
 *
 * Requests both `inputAudioTranscription` and
 * `outputAudioTranscription` unconditionally: the Live API produces
 * both as a side effect of the conversation itself, which means
 * Diamond tier needs no separate STT step (like Gold) AND no manual
 * tracking of the model's spoken reply as text (unlike Free/Gold,
 * which accumulate `fullText` from `text_delta` events) — the
 * transcript IS the event stream.
 */
export class GeminiLiveClient
  implements LiveClient
{
  private readonly client: GoogleGenAI;

  private readonly logger: AppLogger;

  constructor(
    options: GeminiLiveClientOptions
  ) {
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
    });

    this.logger = options.logger;
  }

  async connect(
    options: LiveSessionOptions
  ): Promise<LiveSession> {
    const emitter =
      new EventEmitter();

    /*
     * A session's own `events()` consumer is one listener, but the
     * default cap (10) is easy to trip during development (a hot
     * reload leaving an old session's listener attached alongside
     * a new one) — this is a long-lived, low-volume emitter, not a
     * hot path where an unbounded listener count would itself be a
     * real leak signal.
     */
    emitter.setMaxListeners(0);

    let resolveOpen:
      () => void;

    let rejectOpen:
      (error: Error) => void;

    const opened = new Promise<void>(
      (resolve, reject) => {
        resolveOpen = resolve;
        rejectOpen = reject;
      }
    );

    const rawSession =
      await this.withConnectTimeout(
        this.client.live.connect({
          model: options.model,

          config: {
            responseModalities: [
              Modality.AUDIO,
            ],

            systemInstruction:
              options.systemInstruction,

            tools:
              options.tools &&
              options.tools
                .length > 0
                ? [
                    {
                      functionDeclarations:
                        this.toFunctionDeclarations(
                          options.tools
                        ),
                    },
                  ]
                : undefined,

            speechConfig:
              options.voiceName
                ? {
                    voiceConfig: {
                      prebuiltVoiceConfig:
                        {
                          voiceName:
                            options.voiceName,
                        },
                    },
                  }
                : undefined,

            /*
             * Empty objects, not omitted — presence is what turns
             * each transcription stream on; the config fields
             * don't need any options set for our use case (BCP-47
             * hints etc. are for accuracy tuning, not required).
             */
            inputAudioTranscription:
              {},

            outputAudioTranscription:
              {},

            abortSignal:
              options.signal,
          },

          callbacks: {
            onopen: () => {
              resolveOpen();
            },

            onmessage: (
              message: LiveServerMessage
            ) => {
              for (const event of this.toSessionEvents(
                message
              )) {
                emitter.emit(
                  "event",
                  event
                );
              }
            },

            onerror: (
              event: ErrorEvent
            ) => {
              this.logger.error(
                {
                  module: "live",
                  provider: "gemini",
                  err: event.error,
                },
                "Live session error"
              );

              const error =
                new Error(
                  event.message ||
                    "Live session error"
                );

              rejectOpen(error);

              emitter.emit("event", {
                type: "error",
                error,
              } satisfies LiveSessionEvent);
            },

            onclose: (
              event: CloseEvent
            ) => {
              /*
               * The close code/reason is the only place setup
               * failures surface (e.g. an unsupported model name
               * closes with code 1008 and a reason string) — the
               * SDK's own `connect()` promise does NOT reject on
               * this, confirmed live, hence `withConnectTimeout`.
               */
              this.logger.debug(
                {
                  module: "live",
                  provider: "gemini",
                  code: event.code,
                  reason: event.reason,
                },
                "Live session closed"
              );

              emitter.emit("event", {
                type: "closed",
              } satisfies LiveSessionEvent);
            },
          },
        })
      );

    await opened;

    this.logger.debug(
      {
        module: "live",
        provider: "gemini",
        model: options.model,
      },
      "Live session connected"
    );

    return new GeminiLiveSession(
      rawSession,
      emitter
    );
  }

  private withConnectTimeout<T>(
    promise: Promise<T>
  ): Promise<T> {
    return new Promise<T>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Live session did not open within ${CONNECT_TIMEOUT_MS}ms (commonly an unsupported model name — the server closes without the SDK surfacing why)`
            )
          );
        }, CONNECT_TIMEOUT_MS);

        promise.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          }
        );
      }
    );
  }

  /**
   * `parametersJsonSchema`, not `parameters` — the latter expects
   * Gemini's own typed `Schema` shape, while our MCP tools'
   * `inputSchema` (and any future non-MCP tool declared here) is
   * plain JSON Schema. The two are mutually exclusive on
   * `FunctionDeclaration`; `parametersJsonSchema` is the one that
   * accepts arbitrary JSON Schema as-is.
   */
  private toFunctionDeclarations(
    tools: LiveToolDeclaration[]
  ) {
    return tools.map((tool) => ({
      name: tool.name,
      description:
        tool.description,
      parametersJsonSchema:
        tool.parameters,
    }));
  }

  /**
   * One server message can carry several independent pieces of
   * information at once (a transcript delta AND an audio chunk AND
   * a turn-complete signal, say) — this fans each out into its own
   * `LiveSessionEvent` so consumers don't have to re-derive that
   * themselves from the raw shape.
   */
  private toSessionEvents(
    message: LiveServerMessage
  ): LiveSessionEvent[] {
    const events: LiveSessionEvent[] =
      [];

    const content =
      message.serverContent;

    if (
      content?.inputTranscription
        ?.text
    ) {
      events.push({
        type: "input_transcript",

        text: content
          .inputTranscription.text,

        final:
          content
            .inputTranscription
            .finished ?? false,
      });
    }

    if (
      content?.outputTranscription
        ?.text
    ) {
      events.push({
        type: "output_transcript",

        text: content
          .outputTranscription
          .text,

        final:
          content
            .outputTranscription
            .finished ?? false,
      });
    }

    const parts =
      content?.modelTurn?.parts ??
      [];

    for (const part of parts) {
      if (
        part.inlineData?.data
      ) {
        events.push({
          type: "audio_chunk",

          data: Buffer.from(
            part.inlineData.data,
            "base64"
          ),

          mimeType:
            part.inlineData
              .mimeType ??
            "audio/pcm",
        });
      }
    }

    if (content?.interrupted) {
      events.push({
        type: "interrupted",
      });
    }

    if (content?.turnComplete) {
      events.push({
        type: "turn_complete",
      });
    }

    const calls =
      message.toolCall
        ?.functionCalls;

    if (calls && calls.length > 0) {
      events.push({
        type: "tool_call",

        calls: calls.map(
          (call) => ({
            id: call.id ?? "",
            name: call.name ?? "",
            args:
              call.args ?? {},
          })
        ),
      });
    }

    return events;
  }
}

class GeminiLiveSession
  implements LiveSession
{
  constructor(
    private readonly rawSession: RawLiveSession,

    private readonly emitter: EventEmitter
  ) {}

  sendAudioChunk(
    data: Buffer,
    mimeType: string
  ): void {
    this.rawSession.sendRealtimeInput(
      {
        audio: {
          data: data.toString(
            "base64"
          ),
          mimeType,
        },
      }
    );
  }

  endAudioTurn(): void {
    this.rawSession.sendRealtimeInput(
      {
        audioStreamEnd: true,
      }
    );
  }

  sendToolResult(
    id: string,
    name: string,
    output: unknown
  ): void {
    this.rawSession.sendToolResponse(
      {
        functionResponses: [
          {
            id,
            name,
            response: { output },
          },
        ],
      }
    );
  }

  async *events(): AsyncIterable<LiveSessionEvent> {
    for await (const [
      event,
    ] of on(
      this.emitter,
      "event"
    )) {
      const typedEvent =
        event as LiveSessionEvent;

      yield typedEvent;

      if (
        typedEvent.type ===
        "closed"
      ) {
        return;
      }
    }
  }

  close(): void {
    this.rawSession.close();
  }
}
