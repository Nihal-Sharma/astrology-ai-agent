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
}

export class PlannerService {
  constructor(
    private readonly dependencies: PlannerDependencies
  ) {}

  async createPlan(
    window: PromptContextWindow,
    signal?: AbortSignal
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
${window.currentMessage}

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
      });

    let parsed: unknown;

    try {
      parsed = JSON.parse(
        response.text
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

    return result.data;
  }
}