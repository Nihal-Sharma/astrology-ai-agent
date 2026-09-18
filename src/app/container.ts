import { config } from "./config";

import {
  MongoDatabase,
  RedisDatabase,
} from "../infrastructure/database";

import {
  logger,
  AppLogger,
} from "../infrastructure/observability/logger";

import {
  OpenAiLlmClient,
} from "../infrastructure/llm";

import {
  OpenAiEmbeddingClient,
} from "../infrastructure/embeddings";

import {
  STTClient,
  TTSClient,
} from "../infrastructure/speech";

import {
  UserRepository,
  UserService,
} from "../modules/user";

import {
  BirthProfileRepository,
  BirthProfileService,
} from "../modules/birth-profile";

import {
  PartnerProfileRepository,
  PartnerProfileService,
} from "../modules/partner-profile";

import {
  ConversationRepository,
  ConversationService,
  ConversationSummarizer,
  ConversationWindowService,
} from "../modules/conversation";

import {
  MemoryRepository,
  MemoryExtractor,
  MemoryRetriever,
  MemoryConsolidator,
  MemoryService,
} from "../modules/memory";

import {
  KnowledgeCardRepository,
  RAGRetriever,
  RAGReranker,
  RAGService,
} from "../modules/rag";

import {
  AgentService,
  AgentOrchestrator,
  PlannerService,
  ContextBuilder,
  ContextWindowBuilder,
  ResponseService,
} from "../modules/agent";
import {
  AstrologyService,
  AstrologyMcpClient,
  McpExecutor,
  McpToolRegistry,
  McpCache,
  ASTROLOGY_TOOL_CATALOG,
} from "../modules/astrology";
import type {
  AvailableAstrologyTool,
} from "../modules/agent/planner/planner.service";
import { McpArgumentResolver } from "../modules/astrology/mcp/mcp.argument-resolver";

export interface AppContainer {
  config: typeof config;

  logger: AppLogger;

  llm: OpenAiLlmClient;

  speech: {
    stt: STTClient;
    tts: TTSClient;
  };

  db: {
    mongo: MongoDatabase;
    redis: RedisDatabase;
  };
  astrology: {
    mcp: AstrologyMcpClient;
    toolRegistry: McpToolRegistry;
    cache: McpCache;
  };

  repositories: {
    user: UserRepository;
    birthProfile: BirthProfileRepository;
    partnerProfile: PartnerProfileRepository;
    conversation: ConversationRepository;
  };

  services: {
    user: UserService;
    birthProfile: BirthProfileService;
    partnerProfile: PartnerProfileService;
    conversation: ConversationService;
    agent: AgentService;
   astrology: AstrologyService;
  };

  /**
   * Cascade-deletes everything owned by a user account — birth
   * profile, partner profiles they added, conversations +
   * messages, and memories — before deleting the user record
   * itself. See §6 (Data privacy) / PRIVACY.md. Exposed at the
   * container level (not a module service) since it's the one
   * operation that legitimately spans every module's data.
   */
  deleteUserAccount(
    userId: string
  ): Promise<boolean>;
}
function extractRequiredInputs(
  inputSchema: unknown
): string[] {
  if (
    typeof inputSchema !==
    "object" ||
    inputSchema === null
  ) {
    return [];
  }

  const schema =
    inputSchema as {
      required?: unknown;
    };

  if (
    !Array.isArray(
      schema.required
    )
  ) {
    return [];
  }

  return schema.required.filter(
    (
      item
    ): item is string =>
      typeof item === "string"
  );
}

function toAvailableAstrologyTools(
  registry: McpToolRegistry
): AvailableAstrologyTool[] {
  return registry
    .getEnabled()
    .map((tool) => ({
      name: tool.name,

      description:
        tool.description ?? "",

      categories:
        tool.categories,

      requiredInputs:
        extractRequiredInputs(
          tool.inputSchema
        ),
    }));
}

export function createContainer(): AppContainer {
  /*
   * ============================================================
   * Infrastructure
   * ============================================================
   */

  const mongo = new MongoDatabase({
    uri: config.database.mongoUri,

    logger,

    maxPoolSize: 20,
    minPoolSize: 5,

    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  const redis = new RedisDatabase({
    url: config.redis.url,

    logger,

    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  const llm = new OpenAiLlmClient({
    apiKey: config.llm.apiKey,

    defaultModel: config.llm.model,

    logger,
  });

  /*
   * Reuses the same OpenAI account/key as the LLM — no
   * separate credential needed for STT.
   */
  const sttClient = new STTClient({
    apiKey: config.llm.apiKey,

    defaultModel:
      config.speech.sttModel,

    logger,
  });

  const ttsClient = new TTSClient({
    apiKey: config.llm.apiKey,

    defaultModel:
      config.speech.ttsModel,

    logger,
  });

  /*
   * Same key again — no separate embeddings credential needed.
   */
  const embeddingClient =
    new OpenAiEmbeddingClient({
      apiKey: config.llm.apiKey,

      defaultModel:
        config.rag.embeddingModel,

      logger,
    });

  /*
   * ============================================================
   * Repositories
   * ============================================================
   */

  const userRepository =
    new UserRepository();

  const birthProfileRepository =
    new BirthProfileRepository();

  const partnerProfileRepository =
    new PartnerProfileRepository();

  const conversationRepository =
    new ConversationRepository();

  /*
   * ============================================================
   * Domain Services
   * ============================================================
   */

  const userService =
    new UserService(
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

  /*
   * ============================================================
   * Memory
   * ============================================================
   */

  const memoryRepository =
    new MemoryRepository();

  const memoryExtractor =
    new MemoryExtractor(
      llm,
      logger
    );

  const memoryConsolidator =
    new MemoryConsolidator(
      config.memory
        .duplicateSimilarityThreshold
    );

  const memoryRetrieverInstance =
    new MemoryRetriever(
      memoryRepository,
      embeddingClient,
      memoryConsolidator,
      logger
    );

  const memoryService =
    new MemoryService(
      memoryRepository,
      memoryExtractor,
      memoryRetrieverInstance,
      memoryConsolidator,
      embeddingClient,
      logger
    );

  /*
   * Respect ENABLE_MEMORY: when disabled, the agent gets a
   * no-op that always behaves like "no memories yet" rather than
   * every call site needing its own flag check.
   */
  const memoryDependency =
    config.features.enableMemory
      ? {
          retrieve: (
            userId: string,
            query: string | string[],
            topK: number
          ) =>
            memoryService.retrieve(
              userId,
              query,
              topK
            ),

          extractAndStore: (
            input: {
              userId: string;
              conversationId: string;
              userMessage: string;
              assistantMessage: string;
            }
          ) =>
            memoryService.extractAndStore(
              input
            ),
        }
      : {
          async retrieve() {
            return [];
          },

          async extractAndStore() {
            /* Memory disabled via ENABLE_MEMORY. */
          },
        };

  /*
   * ============================================================
   * Temporary Agent Dependencies
   *
   * These are placeholders until we implement:
   * - Astrology MCP
   * - RAG
   *
   * They allow the Agent module to be wired now.
   * ============================================================
   */

  // const astrologyService = {
  //   async executeTools(
  //     _tools: string[],
  //     _input: {
  //       userId: string;

  //       conversationId: string;

  //       message: string;

  //       birthProfile: unknown;

  //       signal?: AbortSignal;
  //     }
  //   ) {
  //     return [];
  //   },
  // };
  const astrologyMcpClient =
  new AstrologyMcpClient(
    {
      serverUrl:
        config.mcp
          .astrologyServerUrl,

      apiKey:
        config.mcp
          .astrologyApiKey,

      timeoutMs:
        config.mcp
          .requestTimeoutMs,

      clientName:
        config.app.name,

      clientVersion:
        "1.0.0",
    },

    logger
  );

const astrologyToolRegistry = new McpToolRegistry();

/*
 * Temporary tools until we know the
 * real remote MCP tool catalog.
 */
astrologyToolRegistry.registerMany(
   ASTROLOGY_TOOL_CATALOG
);

const mcpCache =
  new McpCache(
    redis
  );

const mcpExecutor =
  new McpExecutor(
    astrologyMcpClient,
    astrologyToolRegistry,
    mcpCache,
    logger
  );

const argumentResolver =
  new McpArgumentResolver();
const astrologyService =
  new AstrologyService(
    mcpExecutor,
    argumentResolver,
    astrologyToolRegistry,
    logger
  );

  /*
   * ============================================================
   * RAG
   * ============================================================
   */

  const knowledgeCardRepository =
    new KnowledgeCardRepository();

  const ragRetriever =
    new RAGRetriever(
      knowledgeCardRepository,
      embeddingClient,
      logger
    );

  const ragReranker =
    new RAGReranker();

  const ragServiceInstance =
    new RAGService(
      ragRetriever,
      ragReranker
    );

  /*
   * Respect ENABLE_RAG: when disabled, the agent gets a no-op
   * that always behaves like "no knowledge cards yet" — same
   * pattern as memoryDependency above. In practice this also
   * covers the current MVP state where no content has been
   * sourced/seeded yet, so retrieval returns `[]` either way;
   * the flag lets that be toggled without touching call sites
   * once real content lands.
   */
  const ragDependency =
    config.features.enableRag
      ? {
          retrieve: (
            queries: string[],
            topK: number
          ) =>
            ragServiceInstance.retrieve(
              queries,
              topK
            ),
        }
      : {
          async retrieve() {
            return [];
          },
        };

  /*
   * ============================================================
   * Agent
   * ============================================================
   */

  const planner =
    new PlannerService({
      llm,

      /*
       * Live getter, not a snapshot: the registry is synced
       * from the real MCP server at boot (after this planner
       * is constructed), via syncAstrologyToolsFromServer in
       * src/index.ts.
       */
      getAstrologyTools: () =>
        toAvailableAstrologyTools(
          astrologyToolRegistry
        ),
    });

  const contextBuilder =
    new ContextBuilder(
      {
        conversationService,
        birthProfileService,
        partnerProfileService,
        memoryRetriever:
          memoryDependency,
      },
      {
        resumeGapHours:
          config.agent
            .resumeGapHours,
      }
    );

  const contextWindowBuilder =
    new ContextWindowBuilder({
      totalTokens:
        config.agent
          .contextTokenBudget,
    });

  const responseService =
    new ResponseService(
      llm
    );

  const conversationSummarizer =
    new ConversationSummarizer(
      llm
    );

  const conversationWindowService =
    new ConversationWindowService(
      conversationService,
      conversationSummarizer,
      {
        recentMessageKeepCount:
          config.agent
            .recentMessageKeepCount,

        summaryBatchSize:
          config.agent
            .summaryBatchSize,
      },
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

      astrology:
        astrologyService,

      rag:
        ragDependency,

      memory:
        memoryDependency,
    });

  const agentService =
    new AgentService(
      agentOrchestrator
    );

  /*
   * ============================================================
   * Account deletion (cascade)
   * ============================================================
   */

  async function deleteUserAccount(
    userId: string
  ): Promise<boolean> {
    const user =
      await userRepository.findById(
        userId
      );

    if (!user) {
      return false;
    }

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

      memoryRepository.deleteByUserId(
        userId
      ),
    ]);

    await userRepository.deleteById(
      userId
    );

    return true;
  }

  /*
   * ============================================================
   * Container
   * ============================================================
   */

  return {
    config,

    deleteUserAccount,

    logger,

    llm,

    speech: {
      stt: sttClient,
      tts: ttsClient,
    },

    db: {
      mongo,
      redis,
    },

    astrology: {
      mcp: astrologyMcpClient,
      toolRegistry:
      astrologyToolRegistry,

  cache:
    mcpCache,
},
    repositories: {
      user: userRepository,

      birthProfile:
        birthProfileRepository,

      partnerProfile:
        partnerProfileRepository,

      conversation:
        conversationRepository,
    },

    services: {
      user: userService,

      birthProfile:
        birthProfileService,

      partnerProfile:
        partnerProfileService,

      conversation:
        conversationService,
     astrology:
         astrologyService,
      agent:
        agentService,
    },
  };
}