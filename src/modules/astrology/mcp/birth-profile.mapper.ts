import {
  BirthProfile,
} from "../../birth-profile";

export interface DecomposedBirthProfile {
  day?: number;

  month?: number;

  year?: number;

  hour?: number;

  min?: number;

  lat?: number;

  lon?: number;

  /**
   * UTC offset in hours (e.g. 5.5 for IST), DST-aware for the
   * birth date. This is what most live MCP tools call `tzone`.
   */
  tzone?: number;

  /**
   * Raw IANA zone name (e.g. "Asia/Kolkata"), unconverted.
   * Some tools (the `timezone` lookup tool) want this string
   * directly rather than a numeric offset.
   */
  timezoneName?: string;

  place?: string;

  /**
   * Legacy combined-string fields, kept only for
   * compatibility with the bundled static tool catalog (used
   * as a fallback if live MCP tool sync ever fails) which
   * predates the live server's day/month/year/... schema.
   */
  dateOfBirthIso?: string;

  timeOfBirthRaw?: string;
}

/**
 * Parses free-text birth time into 24-hour hour/minute.
 *
 * `BirthProfile.timeOfBirth` is raw, unvalidated user input
 * (see birth-profile.types.ts) — examples given there are
 * "13:02" and "1:02 PM". Returns undefined for anything else
 * rather than guessing, so callers surface a clear "missing
 * required argument" instead of silently sending a wrong time
 * into a chart calculation.
 */
export function parseTimeOfBirth(
  raw: string
): { hour: number; min: number } | undefined {
  const trimmed = raw.trim();

  const twentyFourHour = trimmed.match(
    /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/
  );

  if (twentyFourHour) {
    return {
      hour: Number(
        twentyFourHour[1]
      ),

      min: Number(
        twentyFourHour[2]
      ),
    };
  }

  const twelveHour = trimmed.match(
    /^(1[0-2]|0?\d):([0-5]\d)\s*([AaPp][Mm])$/
  );

  if (twelveHour) {
    let hour =
      Number(twelveHour[1]) % 12;

    const isPm =
      twelveHour[3].toLowerCase() ===
      "pm";

    if (isPm) {
      hour += 12;
    }

    return {
      hour,

      min: Number(twelveHour[2]),
    };
  }

  return undefined;
}

/**
 * DST-aware UTC offset (in hours) for an IANA timezone at a
 * given instant, using the platform's built-in ICU data —
 * no timezone-database dependency needed.
 *
 * `BirthProfile.timezone` is treated as an IANA zone
 * identifier (e.g. "Asia/Kolkata"), matching what the live
 * MCP server's own `timezone`/`geo_details` tools expect and
 * return.
 */
export function getUtcOffsetHours(
  ianaZone: string,
  atDate: Date
): number | undefined {
  try {
    const formatter =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone: ianaZone,
          hour12: false,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }
      );

    const parts = formatter
      .formatToParts(atDate)
      .reduce<
        Record<string, string>
      >((acc, part) => {
        acc[part.type] =
          part.value;

        return acc;
      }, {});

    /*
     * `hour: "2-digit", hour12: false` can format midnight
     * as "24" in some ICU implementations — normalize to 0.
     */
    const hour =
      Number(parts.hour) % 24;

    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hour,
      Number(parts.minute),
      Number(parts.second)
    );

    const offsetMinutes = Math.round(
      (asUtc - atDate.getTime()) /
        60000
    );

    return offsetMinutes / 60;
  } catch {
    return undefined;
  }
}

/**
 * Decomposes a birth profile once into every representation
 * the live (and legacy static) MCP tool schemas ask for.
 */
export function decomposeBirthProfile(
  birthProfile:
    | BirthProfile
    | null
    | undefined
): DecomposedBirthProfile {
  if (!birthProfile) {
    return {};
  }

  const day =
    birthProfile.dateOfBirth.getUTCDate();

  const month =
    birthProfile.dateOfBirth.getUTCMonth() +
    1;

  const year =
    birthProfile.dateOfBirth.getUTCFullYear();

  const time = parseTimeOfBirth(
    birthProfile.timeOfBirth
  );

  /*
   * Reference instant for the DST-aware offset lookup: noon
   * UTC on the birth date, to stay clear of a DST boundary
   * that might fall near midnight for that zone.
   */
  const referenceInstant = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      12,
      0,
      0
    )
  );

  const tzone = getUtcOffsetHours(
    birthProfile.timezone,
    referenceInstant
  );

  return {
    day,
    month,
    year,

    hour: time?.hour,
    min: time?.min,

    lat: birthProfile.latitude,
    lon: birthProfile.longitude,

    tzone,

    timezoneName:
      birthProfile.timezone,

    place:
      birthProfile.placeOfBirth,

    dateOfBirthIso:
      birthProfile.dateOfBirth.toISOString(),

    timeOfBirthRaw:
      birthProfile.timeOfBirth,
  };
}
