import { AgentContext } from "../agent.types";
export type { AgentContext };

export interface ContextBuilderInput {
  userId: string;

  conversationId: string;

  message: string;
}

export interface ContextBuilderDependencies {
  conversationService: {
    buildContext(
      conversationId: string,
      recentMessageLimit?: number
    ): Promise<
      import("../../conversation").ConversationContext | null
    >;

    getLatestOtherConversation(
      userId: string,
      excludeConversationId: string
    ): Promise<
      import("../../conversation").Conversation | null
    >;
  };

  birthProfileService: {
    getBirthProfile(
      userId: string
    ): Promise<
      import("../../birth-profile").BirthProfile | null
    >;
  };

  partnerProfileService: {
    getPartnerProfile(
      conversationId: string
    ): Promise<
      import("../../partner-profile").PartnerProfile | null
    >;
  };

  memoryRetriever: {
    retrieve(
      userId: string,
      query: string | string[],
      limit: number
    ): Promise<
      import("../agent.types").MemoryResult[]
    >;
  };
}

export type BuiltAgentContext =
  AgentContext;