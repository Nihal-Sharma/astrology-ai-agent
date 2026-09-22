import {
  AgentExecutionResults,
} from "../agent.types";

import {
  PromptContextWindow,
} from "../context/context-window.builder";

import {
  AgentPlan,
} from "../planner/planner.types";

export interface ResponseGenerationInput {
  window: PromptContextWindow;

  plan: AgentPlan;

  results: AgentExecutionResults;

  signal?: AbortSignal;
}

export interface ResponseStreamEvent {
  type:
    | "text_delta"
    | "completed"
    | "error";

  text?: string;

  error?: Error;
}