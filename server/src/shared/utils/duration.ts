const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/**
 * Renders a millisecond duration as a coarse human phrase
 * ("3 days", "about a month") for use in resume/recap prompts.
 *
 * Deliberately imprecise: the model only needs a rough sense
 * of elapsed time, not an exact count.
 */
export function formatDuration(ms: number): string {
  if (ms < HOUR_MS) {
    return plural(Math.max(1, Math.round(ms / MINUTE_MS)), "minute");
  }

  if (ms < DAY_MS) {
    return plural(Math.round(ms / HOUR_MS), "hour");
  }

  if (ms < MONTH_MS) {
    return plural(Math.round(ms / DAY_MS), "day");
  }

  if (ms < YEAR_MS) {
    return plural(Math.round(ms / MONTH_MS), "month");
  }

  return plural(Math.round(ms / YEAR_MS), "year");
}
