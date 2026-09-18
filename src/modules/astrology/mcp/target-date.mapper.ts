const DEFAULT_RANGE_DAYS = 7;

/**
 * Translates the planner's single canonical target
 * date/range into the various provider-specific extra
 * parameter names that different live tools actually expect
 * for transit/predictive queries:
 * - `dasha_date` — "as of" date for dasha drill-down tools
 * - `start_date`/`end_date` — window for `global_transits`
 * - `varshaphal_year`/`solar_year` — target year for annual
 *   (solar return) charts
 *
 * The argument resolver already treats `extras` as
 * highest-priority explicit values (see
 * `McpArgumentResolver.resolveParameter`), so this only needs
 * to produce the record — the resolver picks out whichever
 * keys a given tool's schema actually declares.
 */
export function buildTargetDateExtras(
  targetDate:
    | string
    | null
    | undefined,

  targetRangeDays:
    | number
    | null
    | undefined
): Record<string, unknown> {
  if (!targetDate) {
    return {};
  }

  const start = new Date(
    `${targetDate}T00:00:00.000Z`
  );

  if (
    Number.isNaN(start.getTime())
  ) {
    return {};
  }

  const end = new Date(start);

  end.setUTCDate(
    end.getUTCDate() +
      (targetRangeDays ??
        DEFAULT_RANGE_DAYS)
  );

  const toIsoDate = (
    date: Date
  ): string =>
    date
      .toISOString()
      .slice(0, 10);

  /*
   * `global_transits` rejects ISO dates outright (confirmed
   * live: "Astrology API responded with HTTP 405 ... Provide
   * start and end date in dd-mm-yyyy format") even though
   * `dasha_date` accepts ISO fine — the provider isn't
   * consistent across its own tools.
   */
  const toDdMmYyyy = (
    date: Date
  ): string => {
    const day = String(
      date.getUTCDate()
    ).padStart(2, "0");

    const month = String(
      date.getUTCMonth() + 1
    ).padStart(2, "0");

    return `${day}-${month}-${date.getUTCFullYear()}`;
  };

  return {
    dasha_date: toIsoDate(start),

    start_date:
      toDdMmYyyy(start),

    end_date: toDdMmYyyy(end),

    varshaphal_year:
      start.getUTCFullYear(),

    solar_year:
      start.getUTCFullYear(),
  };
}
