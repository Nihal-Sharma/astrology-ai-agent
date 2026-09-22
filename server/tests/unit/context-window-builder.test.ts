import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { ContextWindowBuilder } from "../../src/modules/agent/context/context-window.builder";
import { AgentContext } from "../../src/modules/agent/agent.types";
import { countTokens } from "../../src/shared/utils/tokenizer";

function makeContext(
  overrides: Partial<AgentContext> = {}
): AgentContext {
  const now = new Date();

  return {
    userId: "user-1",
    conversationId: "conv-1",
    currentMessage: "What does my chart say about today?",
    conversation: {
      conversation: {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      recentMessages: [],
    },
    birthProfile: null,
    partnerProfile: null,
    memories: [],
    inputType: "text",
    resume: { isResuming: false },
    ...overrides,
  };
}

describe("ContextWindowBuilder.build", () => {
  it("passes through the current message, userId, and conversationId unchanged", () => {
    const builder = new ContextWindowBuilder({ totalTokens: 6000 });
    const window = builder.build(makeContext());

    expect(window.userId).toBe("user-1");
    expect(window.conversationId).toBe("conv-1");
    expect(window.currentMessage).toBe(
      "What does my chart say about today?"
    );
  });

  it("adds a resume note only when the context says the user is resuming", () => {
    const builder = new ContextWindowBuilder({ totalTokens: 6000 });

    const notResuming = builder.build(makeContext());
    expect(notResuming.resumeNote).toBeUndefined();

    const resuming = builder.build(
      makeContext({
        resume: { isResuming: true, gapDescription: "3 weeks" },
      })
    );
    expect(resuming.resumeNote).toContain("3 weeks");
  });

  it("drops the last recent message when it duplicates the current turn's message (already shown separately)", () => {
    const builder = new ContextWindowBuilder({ totalTokens: 6000 });

    const window = builder.build(
      makeContext({
        currentMessage: "duplicate me",
        conversation: {
          conversation: {
            _id: new Types.ObjectId(),
            userId: new Types.ObjectId(),
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          recentMessages: [
            {
              _id: new Types.ObjectId(),
              conversationId: new Types.ObjectId(),
              userId: new Types.ObjectId(),
              role: "assistant",
              content: "earlier reply",
              contentType: "text",
              createdAt: new Date(),
            },
            {
              _id: new Types.ObjectId(),
              conversationId: new Types.ObjectId(),
              userId: new Types.ObjectId(),
              role: "user",
              content: "duplicate me",
              contentType: "text",
              createdAt: new Date(),
            },
          ],
        },
      })
    );

    expect(window.recentMessages).toHaveLength(1);
    expect(window.recentMessages[0].content).toBe("earlier reply");
  });

  it("keeps the most recent messages and drops the oldest ones under a tight token budget", () => {
    // A tiny budget that can only fit a couple of short messages.
    const builder = new ContextWindowBuilder({ totalTokens: 40 });

    const recentMessages = Array.from({ length: 20 }, (_, i) => ({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      role: "user" as const,
      content: `message number ${i}`,
      contentType: "text" as const,
      createdAt: new Date(),
    }));

    const window = builder.build(
      makeContext({
        currentMessage: "current turn message, not in history",
        conversation: {
          conversation: {
            _id: new Types.ObjectId(),
            userId: new Types.ObjectId(),
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          recentMessages,
        },
      })
    );

    expect(window.recentMessages.length).toBeGreaterThan(0);
    expect(window.recentMessages.length).toBeLessThan(20);

    // Whatever survived the trim must be the newest messages,
    // in original chronological order (oldest-of-the-kept first).
    const survivingContents = window.recentMessages.map(
      (m) => m.content
    );
    const lastOriginal = recentMessages[recentMessages.length - 1]
      .content;
    expect(survivingContents[survivingContents.length - 1]).toBe(
      lastOriginal
    );

    for (let i = 1; i < survivingContents.length; i++) {
      const prevIndex = recentMessages.findIndex(
        (m) => m.content === survivingContents[i - 1]
      );
      const currIndex = recentMessages.findIndex(
        (m) => m.content === survivingContents[i]
      );
      expect(currIndex).toBeGreaterThan(prevIndex);
    }
  });

  it("always keeps at least one message even if it alone exceeds the budget (hard-truncated)", () => {
    const builder = new ContextWindowBuilder({ totalTokens: 5 });

    const longMessage = "word ".repeat(500);

    const window = builder.build(
      makeContext({
        conversation: {
          conversation: {
            _id: new Types.ObjectId(),
            userId: new Types.ObjectId(),
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          recentMessages: [
            {
              _id: new Types.ObjectId(),
              conversationId: new Types.ObjectId(),
              userId: new Types.ObjectId(),
              role: "user",
              content: longMessage,
              contentType: "text",
              createdAt: new Date(),
            },
          ],
        },
      })
    );

    expect(window.recentMessages).toHaveLength(1);
    expect(
      countTokens(window.recentMessages[0].content)
    ).toBeLessThan(countTokens(longMessage));
  });

  it("caps memories to at most 5 and preserves content/category", () => {
    const builder = new ContextWindowBuilder({ totalTokens: 6000 });

    const memories = Array.from({ length: 8 }, (_, i) => ({
      id: `mem-${i}`,
      content: `fact number ${i}`,
      category: "identity",
    }));

    const window = builder.build(
      makeContext({ memories })
    );

    expect(window.memories).toHaveLength(5);
    expect(window.memories[0].content).toContain("fact number 0");
    expect(window.memories[0].category).toBe("identity");
  });

  it("builds a prior-conversation note referencing the gap and last topic", () => {
    const builder = new ContextWindowBuilder({ totalTokens: 6000 });

    const window = builder.build(
      makeContext({
        conversation: {
          conversation: {
            _id: new Types.ObjectId(),
            userId: new Types.ObjectId(),
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          recentMessages: [],
        },
        priorConversation: {
          summary: "They discussed a career change.",
          currentTopic: "career",
          gapDescription: "about a month",
        },
      })
    );

    expect(window.priorConversationNote).toContain("about a month");
    expect(window.priorConversationNote).toContain("career");
    expect(window.priorConversationNote).toContain(
      "career change"
    );
  });
});
