import {
  PromptContextWindow,
} from "../../agent/context/context-window.builder";

import {
  buildResponseSystemPrompt,
} from "../../agent/response/response.prompt";

import {
  AgentPersonaMode,
} from "../../agent/planner/planner.types";

/**
 * Decided in ROADMAP.md's Phase D: the Live API halts its own
 * generation to emit a tool-call event and only resumes speaking
 * after `sendToolResult` — genuine dead air unless the model fills
 * it with a short spoken acknowledgment first. Prompt steering, not
 * an API guarantee — see the roadmap entry for why a hard
 * server-side fallback isn't built yet.
 */
const ACKNOWLEDGMENT_FILLER_INSTRUCTIONS = `
TOOL-CALL ACKNOWLEDGMENTS:
Whenever you need to call an astrology tool, say a short, warm
acknowledgment FIRST, in the same language/register you've been
speaking, before making the call — never go silent while looking
something up. Examples:
- "एक मिनट, आपकी कुंडली देखती हूँ..."
- "Wait, let me have a quick look at your kundali..."
- "होल्ड ऑन, चार्ट चेक कर रही हूँ..."
Keep it brief — one short sentence, not a speech. If you need to
call more than one tool for the same question, one acknowledgment
covering the whole lookup is enough — don't repeat it per call.
`;

const TOOL_USAGE_INSTRUCTIONS = `
TOOLS:
You have astrology calculation tools available. Call one whenever
answering requires real chart data (planetary positions, dasha
periods, matchmaking, predictions, etc.) rather than general
knowledge. You do NOT need to supply the user's birth details as
arguments — the server already knows them and fills tool calls in
automatically. Just call the tool by name.

You also have a recall_user_memory tool, for searching things this
user has told you in past conversations (their preferences, life
events, relationships, past questions). Call it when the user
references something you might already know about them, or when
recalling their history would make your answer more personal —
don't call it for every message, only when it would genuinely help.
Pass a short query describing what you want to recall.
`;

const VOICE_DELIVERY_NOTE = `
NOTE: This is a live spoken conversation, not text chat — your
reply is spoken aloud as you generate it, and there is no separate
text-to-speech step to catch formatting mistakes. No markdown, no
headers, no bullet lists, no asterisks, no long numbers read
digit-by-digit. Say it the way you'd actually say it out loud.
`;

/**
 * Builds the one-time system instruction for a Diamond-tier Live
 * session (ROADMAP.md's Phase D). Unlike Free/Gold's per-turn
 * prompt (ResponseService.buildPrompt), this is assembled ONCE at
 * session connect — there's no separate planner step, so no
 * per-turn MCP/RAG results or "PLANNER DECISION" block to include;
 * the model fetches astrology data itself via tool calls instead of
 * receiving it pre-executed.
 *
 * `window.memories` is always empty here and deliberately unused —
 * built before any user message exists, so there's no text to
 * proactively search memories with yet (same limitation
 * `ContextBuilder.build`'s own doc comment documents for Gold's
 * pre-transcript context build). Unlike Free/Gold, Diamond has no
 * planner step to hang a fallback or a `memory.required` flag off
 * of, so it gets memory retrieval through a dedicated Live tool
 * instead (`recall_user_memory` — see `TOOL_USAGE_INSTRUCTIONS`
 * below and `DiamondVoicePipeline.executeMemorySearch`): the model
 * decides at runtime whether something's worth recalling, the same
 * way it already decides when to call an astrology tool.
 */
export function buildDiamondSystemInstruction(
  window: PromptContextWindow,
  personaMode: AgentPersonaMode
): string {
  const notes = [
    window.resumeNote,
    window.priorConversationNote,
  ]
    .filter(
      (note): note is string =>
        Boolean(note)
    )
    .map(
      (note) => `NOTE: ${note}`
    )
    .join("\n");

  return `
${buildResponseSystemPrompt(personaMode)}
${VOICE_DELIVERY_NOTE}
${TOOL_USAGE_INSTRUCTIONS}
${ACKNOWLEDGMENT_FILLER_INSTRUCTIONS}
${notes ? `\n${notes}\n` : ""}
CONVERSATION SUMMARY:
${window.conversationSummary ?? "None"}

CURRENT TOPIC:
${window.currentTopic ?? "None"}

RECENT CONVERSATION:
${
  window.recentMessages.length >
  0
    ? window.recentMessages
        .map(
          (message) =>
            `${message.role}: ${message.content}`
        )
        .join("\n")
    : "None yet — this is the start of the conversation."
}

BIRTH PROFILE:
${
  window.birthProfile
    ? JSON.stringify(
        window.birthProfile,
        null,
        2
      )
    : "No birth profile available"
}

PARTNER PROFILE (for synastry/matchmaking/compatibility questions):
${
  window.partnerProfile
    ? JSON.stringify(
        window.partnerProfile,
        null,
        2
      )
    : "None attached to this conversation"
}
`;
}
