import {
  LlmClient,
} from "../../../infrastructure/llm";

import {
  PromptContextWindow,
} from "../context/context-window.builder";

import {
  AgentPlan,
} from "./planner.types";

import {
  agentPlanSchema,
} from "./planner.schema";

import {
  PLANNER_SYSTEM_PROMPT,
} from "./planner.prompt";

import {
  stripJsonCodeFence,
} from "../../../shared/utils/llm-json";

export interface AvailableAstrologyTool {
  name: string;

  description: string;

  requiredInputs?: string[];

  categories: string[];
}

export interface PlannerDependencies {
  llm: LlmClient;

  /**
   * A getter, not a static array — the astrology tool
   * registry is synced from the live MCP server at boot
   * (after this service is constructed), so the catalog must
   * be read fresh on every plan, not captured once.
   */
  getAstrologyTools(): AvailableAstrologyTool[];

  /**
   * Model for the planner's own call (see container.ts —
   * config.llm.fastModel), independent of the main conversational
   * model. Picking a persona mode and which MCP/RAG/memory tools
   * to invoke is a structured routing decision that doesn't need
   * the main model's depth, and this call is fully sequential and
   * blocks the entire turn (response generation, then TTS) until
   * it finishes — so its latency matters more than its quality.
   */
  model: string;
}

export class PlannerService {
  constructor(
    private readonly dependencies: PlannerDependencies
  ) {}

  /**
   * `audio`: present only for the Gold-tier pipeline (ROADMAP.md's
   * Phase C) — this call transcribes it and plans in one shot
   * instead of receiving already-transcribed text via
   * `window.currentMessage` (which is empty/unset in that case;
   * see GoldVoicePipeline/AgentOrchestrator.buildPlanFromAudio).
   * Throws if audio was given but the model didn't return a
   * transcript — there's no reasonable fallback for a Gold turn
   * with no idea what the user said.
   */
  async createPlan(
    window: PromptContextWindow,
    signal?: AbortSignal,

    audio?: {
      data: Buffer;
      mimeType: string;
    }
  ): Promise<AgentPlan> {
    const availableTools =
      this.dependencies.getAstrologyTools();

    const toolCatalog =
      availableTools
        .map(
          (tool) =>
            `- ${tool.name}: ${tool.description}`
        )
        .join("\n");

    const userPrompt = `
CURRENT DATE:
${new Date().toISOString().slice(0, 10)}

USER MESSAGE:
${
  audio
    ? "(spoken — the user's voice recording is attached as audio below. Transcribe it into \"transcript\" and use that as the user's message for every decision below.)"
    : window.currentMessage
}

BIRTH PROFILE AVAILABLE:
${window.birthProfile ? "yes" : "no"}

PARTNER PROFILE AVAILABLE (for synastry/matchmaking/compatibility):
${window.partnerProfile ? "yes" : "no"}

CONVERSATION SUMMARY:
${window.conversationSummary ?? "None"}

CURRENT TOPIC:
${window.currentTopic ?? "unknown"}

PREVIOUS MODE:
${window.previousPersonaMode ?? "None (first turn in this conversation)"}
${
  window.resumeNote
    ? `\nNOTE: ${window.resumeNote}\n`
    : ""
}${
  window.priorConversationNote
    ? `\nNOTE: ${window.priorConversationNote}\n`
    : ""
}
RECENT CONVERSATION:
${window.recentMessages
  .map(
    (message) =>
      `${message.role}: ${message.content}`
  )
  .join("\n")}

AVAILABLE ASTROLOGY MCP TOOLS:
${toolCatalog}

Return only JSON matching the planner schema.
`;

    const response =
      await this.dependencies.llm.generate({
        model:
          this.dependencies.model,

        instructions:
          PLANNER_SYSTEM_PROMPT,

        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],

        signal,

        maxOutputTokens: 1000,

        audio,
      });

    let parsed: unknown;

    try {
      parsed = JSON.parse(
        stripJsonCodeFence(
          response.text
        )
      );
    } catch {
      throw new Error(
        "Planner returned invalid JSON"
      );
    }

    const result =
      agentPlanSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid planner output: ${result.error.message}`
      );
    }

    /*
     * Safety check:
     *
     * The LLM is only allowed to select tools
     * that actually exist in our registry.
     */
    const availableToolNames =
      new Set(
        availableTools.map(
          (tool) => tool.name
        )
      );

    const invalidTools =
      result.data.mcp.tools.filter(
        (tool) =>
          !availableToolNames.has(tool)
      );

    if (invalidTools.length > 0) {
      throw new Error(
        `Planner selected unknown MCP tools: ${invalidTools.join(", ")}`
      );
    }

    if (
      audio &&
      !result.data.transcript?.trim()
    ) {
      throw new Error(
        "Planner was given audio input but did not return a transcript"
      );
    }

    return result.data;
  }
}