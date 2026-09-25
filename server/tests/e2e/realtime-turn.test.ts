import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { FastifyInstance } from "fastify";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { config } from "../../src/app/config";
import { createApp } from "../../src/app/app";
import { AppContainer } from "../../src/app/container";

import {
  LlmClient,
  LlmGenerateInput,
  LlmResponse,
  LlmStreamChunk,
  OpenAiLlmClient,
} from "../../src/infrastructure/llm";

import { OpenAiSttClient, OpenAiTtsClient } from "../../src/infrastructure/speech";

import { GeminiLiveClient } from "../../src/infrastructure/live";

import { logger } from "../../src/infrastructure/observability/logger";

import {
  MongoDatabase,
  RedisDatabase,
} from "../../src/infrastructure/database";

import {
  UserRepository,
  UserService,
} from "../../src/modules/user";

import {
  BirthProfileRepository,
  BirthProfileService,
} from "../../src/modules/birth-profile";

import {
  PartnerProfileRepository,
  PartnerProfileService,
} from "../../src/modules/partner-profile";

import {
  ConversationRepository,
  ConversationService,
  ConversationSummarizer,
  ConversationWindowService,
} from "../../src/modules/conversation";

import {
  AstrologyService,
  AstrologyMcpClient,
  McpExecutor,
  McpToolRegistry,
  McpCache,
} from "../../src/modules/astrology";
import { McpArgumentResolver } from "../../src/modules/astrology/mcp/mcp.argument-resolver";

import {
  AgentService,
  AgentOrchestrator,
  PlannerService,
  ContextBuilder,
  ContextWindowBuilder,
  ResponseService,
} from "../../src/modules/agent";

const FAKE_SUMMARY_TEXT =
  "The user made small talk across a couple of turns.";

/**
 * A single fake LLM standing in for the real OpenAI-backed
 * planner/response/summarizer calls — real Mongo, real Fastify
 * app, real WebSocket protocol, real persistence/summarization
 * logic are all exercised for real; only the paid API call is
 * faked, for the same reason as the integration test (this
 * project's whole MVP is built around minimizing OpenAI spend —
 * see ROADMAP.md — and a permanent test suite that spends real
 * money on every run is a bad idea regardless).
 */
class FakeAgentLlmClient implements LlmClient {
  async generate(
    input: LlmGenerateInput
  ): Promise<LlmResponse> {
    if (
      input.instructions?.includes(
        "routing planner"
      )
    ) {
      return {
        text: JSON.stringify({
          responseMode: "direct",
          personaMode: "companion",
          mcp: {
            required: false,
            tools: [],
            parallel: false,
            targetDate: null,
            targetRangeDays: null,
          },
          rag: { required: false, queries: [], topK: 0 },
          memory: { required: false, queries: [], topK: 0 },
        }),
        model: "fake-planner",
      };
    }

    if (
      input.instructions?.includes(
        "rolling summary"
      )
    ) {
      return {
        text: JSON.stringify({
          summary: FAKE_SUMMARY_TEXT,
          currentTopic: "small talk",
        }),
        model: "fake-summarizer",
      };
    }

    throw new Error(
      `FakeAgentLlmClient.generate got an unexpected instructions prompt: ${input.instructions?.slice(0, 50)}`
    );
  }

  async *stream(): AsyncIterable<LlmStreamChunk> {
    const text = "Hey! Doing well, thanks for asking.";

    yield { type: "text_delta", text };

    yield {
      type: "completed",
      response: { text, model: "fake-response" },
    };
  }
}

function waitForWsEvent(
  ws: WebSocket,
  matcher: (event: any) => boolean,
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for WS event"));
    }, timeoutMs);

    const onMessage = (rawEvent: MessageEvent) => {
      const event = JSON.parse(rawEvent.data.toString());
      if (matcher(event)) {
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve(event);
      }
    };

    ws.addEventListener("message", onMessage);
  });
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

describe("Realtime turn E2E (real Mongo, real Fastify/WebSocket, fake LLM)", () => {
  let mongod: MongoMemoryServer;
  let mongoDatabase: MongoDatabase;
  let app: FastifyInstance;
  let baseWsUrl: string;
  let baseHttpUrl: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    mongoDatabase = new MongoDatabase({
      uri: mongod.getUri(),
      logger,
    });
    await mongoDatabase.connect();

    const userRepository = new UserRepository();
    const birthProfileRepository =
      new BirthProfileRepository();
    const partnerProfileRepository =
      new PartnerProfileRepository();
    const conversationRepository =
      new ConversationRepository();

    const userService = new UserService(
      userRepository
    );
    const birthProfileService =
      new BirthProfileService(
        birthProfileRepository,
        userService
      );
    const conversationService =
      new ConversationService(
        conversationRepository,
        userService
      );
    const partnerProfileService =
      new PartnerProfileService(
        partnerProfileRepository,
        conversationService
      );

    const fakeLlm = new FakeAgentLlmClient();

    const conversationSummarizer =
      new ConversationSummarizer(fakeLlm);

    const conversationWindowService =
      new ConversationWindowService(
        conversationService,
        conversationSummarizer,
        {
          // Small on purpose: a couple of real chat turns
          // should be enough to cross the batch threshold and
          // trigger a real summarization within the test.
          recentMessageKeepCount: 2,
          summaryBatchSize: 2,
        },
        logger
      );

    const noopMemory = {
      async retrieve() {
        return [];
      },
      async extractAndStore() {
        /* not exercised by this test */
      },
    };

    const noopRag = {
      async retrieve() {
        return [];
      },
    };

    const contextBuilder = new ContextBuilder(
      {
        conversationService,
        birthProfileService,
        partnerProfileService,
        memoryRetriever: noopMemory,
      },
      { resumeGapHours: 6 }
    );

    const contextWindowBuilder =
      new ContextWindowBuilder({
        totalTokens: 6000,
      });

    const planner = new PlannerService({
      llm: fakeLlm,
      model: "gpt-4o-mini",
      getAstrologyTools: () => [],
    });

    const responseService =
      new ResponseService(fakeLlm);

    // Real astrology plumbing, constructed but never actually
    // connected/invoked — the fake planner always sets
    // mcp.required: false, so AgentOrchestrator never calls
    // executeTools on it.
    const redisDatabase = new RedisDatabase({
      url: "redis://127.0.0.1:1",
      logger,
    });
    const astrologyMcpClient =
      new AstrologyMcpClient(
        {
          serverUrl: "http://localhost:0",
          apiKey: "test-key",
          timeoutMs: 1000,
          clientName: "test",
          clientVersion: "0.0.0",
        },
        logger
      );
    const astrologyToolRegistry =
      new McpToolRegistry();
    const mcpCache = new McpCache(
      redisDatabase
    );
    const mcpExecutor = new McpExecutor(
      astrologyMcpClient,
      astrologyToolRegistry,
      mcpCache,
      logger
    );
    const astrologyService =
      new AstrologyService(
        mcpExecutor,
        new McpArgumentResolver(),
        astrologyToolRegistry,
        logger
      );

    const agentOrchestrator =
      new AgentOrchestrator({
        contextBuilder,
        contextWindowBuilder,
        planner,
        responseService,
        logger,
        conversation:
          conversationWindowService,
        astrology: astrologyService,
        rag: noopRag,
        memory: noopMemory,
      });

    const agentService = new AgentService(
      agentOrchestrator
    );

    async function deleteUserAccount(
      userId: string
    ): Promise<boolean> {
      const user =
        await userRepository.findById(
          userId
        );
      if (!user) return false;

      await Promise.all([
        birthProfileRepository.deleteByUserId(
          userId
        ),
        partnerProfileRepository.deleteByUserId(
          userId
        ),
        conversationRepository.deleteAllForUser(
          userId
        ),
      ]);
      await userRepository.deleteById(
        userId
      );
      return true;
    }

    const testContainer: AppContainer = {
      config,
      logger,
      llm: new OpenAiLlmClient({
        apiKey: "test-key",
        defaultModel: "test-model",
        logger,
      }),
      speech: {
        stt: new OpenAiSttClient({
          apiKey: "test-key",
          defaultModel: "test-model",
          logger,
        }),
        tts: new OpenAiTtsClient({
          apiKey: "test-key",
          defaultModel: "test-model",
          logger,
        }),
      },
      // Constructed but never connected — this test's users are
      // all "free" plan, so DiamondVoicePipeline is wired (the
      // gateway always builds it) but never exercised.
      live: new GeminiLiveClient({
        apiKey: "test-key",
        logger,
      }),
      db: {
        mongo: mongoDatabase,
        redis: redisDatabase,
      },
      astrology: {
        mcp: astrologyMcpClient,
        toolRegistry: astrologyToolRegistry,
        cache: mcpCache,
      },
      repositories: {
        user: userRepository,
        birthProfile: birthProfileRepository,
        partnerProfile:
          partnerProfileRepository,
        conversation:
          conversationRepository,
      },
      services: {
        user: userService,
        birthProfile: birthProfileService,
        partnerProfile:
          partnerProfileService,
        conversation: conversationService,
        conversationWindow:
          conversationWindowService,
        agent: agentService,
        astrology: astrologyService,
        memory: noopMemory,
      },
      agentContext: {
        builder: contextBuilder,
        windowBuilder:
          contextWindowBuilder,
      },
      deleteUserAccount,
    };

    app = await createApp({
      container: testContainer,
    });

    await app.listen({
      port: 0,
      host: "127.0.0.1",
    });

    const address = app.server.address();
    const port =
      typeof address === "object" &&
      address
        ? address.port
        : 0;

    baseHttpUrl = `http://127.0.0.1:${port}`;
    baseWsUrl = `ws://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await mongoose.disconnect();
    await mongod.stop();
  });

  it("connects, authenticates, sends real chat turns over WS, persists them in real Mongo, and eventually populates a real summary", async () => {
    const email = `e2e_${Date.now()}@example.com`;

    const registerRes = await fetch(
      `${baseHttpUrl}/auth/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "a real enough password",
          name: "E2E Test",
        }),
      }
    );
    expect(registerRes.status).toBe(201);
    const registerJson = await registerRes.json();
    const token = registerJson.data.token;
    const userId = registerJson.data.user._id;

    const birthProfileRes = await fetch(
      `${baseHttpUrl}/users/${userId}/birth-profile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dateOfBirth: "1995-06-15T00:00:00.000Z",
          timeOfBirth: "14:30",
          placeOfBirth: "Mumbai, India",
          latitude: 19.076,
          longitude: 72.8777,
          timezone: "Asia/Kolkata",
        }),
      }
    );
    expect(birthProfileRes.status).toBe(201);

    const conversationRes = await fetch(
      `${baseHttpUrl}/users/${userId}/conversations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: "E2E test" }),
      }
    );
    expect(conversationRes.status).toBe(201);
    const conversationJson = await conversationRes.json();
    const conversationId = conversationJson.data._id;

    const ws = new WebSocket(
      `${baseWsUrl}/ws?token=${encodeURIComponent(token)}`
    );
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    ws.send(
      JSON.stringify({
        type: "session:start",
        requestId: "s1",
        payload: { conversationId },
      })
    );
    await waitForWsEvent(
      ws,
      (e) => e.type === "session:ready"
    );

    // Two real turns through the real WS protocol — with
    // recentMessageKeepCount/summaryBatchSize both set to 2,
    // this should cross the summarization threshold.
    for (const [i, requestId] of ["t1", "t2"].entries()) {
      ws.send(
        JSON.stringify({
          type: "chat:send",
          requestId,
          payload: { message: `hello, turn ${i}` },
        })
      );
      await waitForWsEvent(
        ws,
        (e) =>
          e.requestId === requestId &&
          e.type === "chat:completed"
      );
    }

    ws.close();

    // Persistence: real Mongo query, not trusting the WS
    // events alone. `chat:completed` is yielded mid-generator,
    // before the orchestrator's trailing `recordAssistantTurn`
    // await resumes and actually finishes writing — so the
    // client can see completion fractionally before the write
    // lands. Poll instead of asserting immediately.
    await waitFor(async () => {
      const count = await mongoose.connection
        .collection("conversationmessages")
        .countDocuments({
          conversationId: new Types.ObjectId(
            conversationId
          ),
        });
      return count === 4;
    });

    const messages = await mongoose.connection
      .collection("conversationmessages")
      .find({
        conversationId: new Types.ObjectId(
          conversationId
        ),
      })
      .toArray();

    expect(messages).toHaveLength(4); // 2 user + 2 assistant
    expect(
      messages.filter((m) => m.role === "user")
    ).toHaveLength(2);
    expect(
      messages.filter((m) => m.role === "assistant")
    ).toHaveLength(2);
    expect(
      messages.every(
        (m) => m.content && m.content.length > 0
      )
    ).toBe(true);

    // Summarization is fire-and-forget after the turn — poll
    // for it rather than assuming it's done by the time
    // chat:completed arrived.
    await waitFor(async () => {
      const doc = await mongoose.connection
        .collection("conversations")
        .findOne({
          _id: new Types.ObjectId(conversationId),
        });
      return !!doc?.summary;
    });

    const conversationDoc = await mongoose.connection
      .collection("conversations")
      .findOne({
        _id: new Types.ObjectId(conversationId),
      });

    expect(conversationDoc?.summary).toBe(
      FAKE_SUMMARY_TEXT
    );
    expect(conversationDoc?.currentTopic).toBe(
      "small talk"
    );
    expect(conversationDoc?.summarizedUntil).toBeTruthy();

    // Cleanup this test's own data.
    await mongoose.connection
      .collection("users")
      .deleteMany({
        _id: new Types.ObjectId(userId),
      });
    await mongoose.connection
      .collection("birthprofiles")
      .deleteMany({
        userId: new Types.ObjectId(userId),
      });
    await mongoose.connection
      .collection("conversations")
      .deleteMany({
        userId: new Types.ObjectId(userId),
      });
    await mongoose.connection
      .collection("conversationmessages")
      .deleteMany({
        userId: new Types.ObjectId(userId),
      });
  });

  it("rejects a WebSocket connection with no token", async () => {
    let rejected = false;
    try {
      const ws = new WebSocket(`${baseWsUrl}/ws`);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener(
          "error",
          () => reject(new Error("rejected")),
          { once: true }
        );
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
