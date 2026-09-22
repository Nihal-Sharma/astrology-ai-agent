import {
  AgentOrchestrator,
} from "./agent.orchestrator";

import {
  AgentAudioTurnInput,
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

  /** See AgentOrchestrator.streamTurnWithAudio — ROADMAP.md's Phase C. */
  streamTurnWithAudio(
    input: AgentAudioTurnInput
  ) {
    return this.orchestrator.streamTurnWithAudio(
      input
    );
  }
}