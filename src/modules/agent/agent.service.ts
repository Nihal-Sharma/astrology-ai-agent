import {
  AgentOrchestrator,
} from "./agent.orchestrator";

import {
  AgentTurnInput,
} from "./agent.types";

export class AgentService {
  constructor(
    private readonly orchestrator: AgentOrchestrator
  ) {}

  streamTurn(
    input: AgentTurnInput
  ) {
    return this.orchestrator.streamTurn(
      input
    );
  }
}