import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  LlmClient,
  LlmGenerateInput,
  LlmResponse,
} from "../../src/infrastructure/llm";

import { logger } from "../../src/infrastructure/observability/logger";

import {
  UserRepository,
  UserService,
} from "../../src/modules/user";

import {
  ConversationRepository,
  ConversationService,
  ConversationSummarizer,
  ConversationWindowService,
} from "../../src/modules/conversation";

/**
 * Real Mongo (in-memory, not mocked), real repositories/services
 * — only the LLM call inside ConversationSummarizer is a fake,
 * since spending real OpenAI budget on every test run isn't
 * worth it (this project's whole MVP is built around minimizing
 * OpenAI spend — see ROADMAP.md). Every actual database write/
 * read here is real.
 */
class FakeSummarizerLlmClient implements LlmClient {
  public lastPrompt: string | undefined;

  async generate(
    input: LlmGenerateInput
  ): Promise<LlmResponse> {
    this.lastPrompt =
      input.messages[0]?.content;

    return {
      text: JSON.stringify({
        summary:
          "The user asked about their sun sign and discussed an upcoming career change.",
        currentTopic: "career",
      }),
      model: "fake-model",
    };
  }

  async *stream(): AsyncIterable<never> {
    throw new Error(
      "FakeSummarizerLlmClient.stream is not used by ConversationSummarizer"
    );
  }
}

describe("Conversation summarization (real Mongo, fake LLM)", () => {
  let mongod: MongoMemoryServer;

  let userService: UserService;

  let conversationService: ConversationService;

  let conversationWindowService: ConversationWindowService;

  let fakeLlm: FakeSummarizerLlmClient;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    await mongoose.connect(mongod.getUri());

    const userRepository = new UserRepository();
    userService = new UserService(userRepository);

    const conversationRepository =
      new ConversationRepository();
    conversationService = new ConversationService(
      conversationRepository,
      userService
    );

    fakeLlm = new FakeSummarizerLlmClient();
    const summarizer = new ConversationSummarizer(
      fakeLlm
    );

    conversationWindowService =
      new ConversationWindowService(
        conversationService,
        summarizer,
        {
          recentMessageKeepCount: 4,
          summaryBatchSize: 5,
        },
        logger
      );
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (db) {
      const collections = await db.collections();
      await Promise.all(
        collections.map((c) => c.deleteMany({}))
      );
    }
  });

  async function makeUserAndConversation() {
    const user = await userService.createUser({
      email: `test_${Date.now()}_${Math.random()}@example.com`,
      passwordHash: "not-a-real-hash",
    });

    const conversation =
      await conversationService.createConversation({
        userId: user._id.toString(),
      });

    return {
      userId: user._id.toString(),
      conversationId:
        conversation._id.toString(),
    };
  }

  it("does not summarize below the configured batch size", async () => {
    const { userId, conversationId } =
      await makeUserAndConversation();

    /*
     * recentMessageKeepCount is 4, so with 6 messages the
     * backlog is only the oldest 2 — below summaryBatchSize
     * (5), so this must NOT trigger summarization yet.
     */
    for (let i = 0; i < 6; i++) {
      await conversationWindowService.recordUserTurn(
        {
          conversationId,
          userId,
          message: `user message ${i}`,
        }
      );
    }

    await conversationWindowService.maybeSummarize(
      conversationId
    );

    const conversation =
      await conversationService.getConversation(
        conversationId
      );

    expect(conversation?.summary).toBeUndefined();
  });

  it("summarizes once the backlog reaches the batch size, using the real Mongo-persisted messages", async () => {
    const { userId, conversationId } =
      await makeUserAndConversation();

    for (let i = 0; i < 6; i++) {
      await conversationWindowService.recordUserTurn(
        {
          conversationId,
          userId,
          message: `user message ${i}`,
        }
      );

      await conversationWindowService.recordAssistantTurn(
        {
          conversationId,
          userId,
          message: `assistant reply ${i}`,
        }
      );
    }

    await conversationWindowService.maybeSummarize(
      conversationId
    );

    const conversation =
      await conversationService.getConversation(
        conversationId
      );

    expect(conversation?.summary).toContain(
      "career change"
    );
    expect(conversation?.currentTopic).toBe("career");
    expect(conversation?.summarizedUntil).toBeDefined();

    // The real persisted message content actually reached the
    // (fake) LLM call, proving this isn't just returning a
    // canned value regardless of input.
    expect(fakeLlm.lastPrompt).toContain(
      "user message 0"
    );
  });

  it("persists a persona mode update and reads it back, via real Mongo", async () => {
    const { conversationId } =
      await makeUserAndConversation();

    await conversationWindowService.updatePersonaMode(
      conversationId,
      "astrologer"
    );

    const conversation =
      await conversationService.getConversation(
        conversationId
      );

    expect(conversation?.lastPersonaMode).toBe(
      "astrologer"
    );
  });

  it("recordAssistantTurn ignores an empty/whitespace-only reply instead of persisting a blank message", async () => {
    const { userId, conversationId } =
      await makeUserAndConversation();

    const result =
      await conversationWindowService.recordAssistantTurn(
        {
          conversationId,
          userId,
          message: "   ",
        }
      );

    expect(result).toBeNull();

    const messages =
      await conversationService.getRecentMessages(
        conversationId
      );

    expect(messages).toHaveLength(0);
  });
});
