import {
  BirthProfile,
} from "../../birth-profile";

import {
  McpToolDefinition,
} from "./mcp.types";

import {
  DecomposedBirthProfile,
  decomposeBirthProfile,
} from "./birth-profile.mapper";

export interface AstrologyPersonContext {
  birthProfile?: BirthProfile | null;

  name?: string;

  place?: string;
}

export interface McpArgumentContext {
  /**
   * Primary user's astrology data.
   */
  user: AstrologyPersonContext;

  /**
   * Optional second person's astrology data.
   *
   * Used for matchmaking / compatibility / synastry tools.
   */
  partner?: AstrologyPersonContext;

  /**
   * Extra values supplied explicitly by the user/request.
   *
   * Examples:
   * - place
   * - name
   * - a specific target date (transits, varshaphal year, ...)
   */
  extras?: Record<string, unknown>;
}

export interface ResolveArgumentsInput {
  tool: McpToolDefinition;

  context: McpArgumentContext;
}

export interface ResolveArgumentsResult {
  arguments: Record<string, unknown>;

  missingRequired: string[];
}

type JsonSchema = {
  type?: string;

  properties?: Record<
    string,
    {
      type?: string;
      description?: string;
    }
  >;

  required?: string[];
};

type PairPrefix = {
  pattern: RegExp;

  person: "user" | "partner";
};

/**
 * Prefixes the live MCP tools actually use for two-person
 * tools:
 * - matchmaking tools use gender prefixes (`m_`/`f_`)
 * - composite/synastry chart tools use primary/secondary
 *   prefixes (`p_`/`s_`)
 *
 * `boy`/`girl` are kept only for backward compatibility with
 * the bundled static tool catalog (used as a fallback if live
 * MCP tool sync ever fails) — the live server doesn't use
 * that convention.
 */
const PAIR_PREFIXES: PairPrefix[] = [
  {
    pattern: /^m_/i,
    person: "user",
  },
  {
    pattern: /^f_/i,
    person: "partner",
  },
  {
    pattern: /^p_/i,
    person: "user",
  },
  {
    pattern: /^s_/i,
    person: "partner",
  },
  {
    pattern: /^boy/i,
    person: "user",
  },
  {
    pattern: /^girl/i,
    person: "partner",
  },
];

export class McpArgumentResolver {
  resolve(
    input: ResolveArgumentsInput
  ): ResolveArgumentsResult {
    const schema =
      this.normalizeSchema(
        input.tool.inputSchema
      );

    const resolved: Record<
      string,
      unknown
    > = {};

    const missingRequired: string[] =
      [];

    const properties =
      schema.properties ?? {};

    const userFields =
      decomposeBirthProfile(
        input.context.user
          .birthProfile
      );

    const partnerFields =
      decomposeBirthProfile(
        input.context.partner
          ?.birthProfile
      );

    /*
     * Resolve only properties declared by
     * the selected tool.
     *
     * We never blindly send the entire
     * birth profile.
     */
    for (
      const parameterName of Object.keys(
        properties
      )
    ) {
      const value =
        this.resolveParameter(
          parameterName,
          input.context,
          userFields,
          partnerFields
        );

      if (
        value !== undefined &&
        value !== null
      ) {
        resolved[parameterName] =
          value;
      }
    }

    /*
     * Make sure all required parameters
     * are actually present.
     */
    for (
      const requiredParameter of
        schema.required ?? []
    ) {
      const value =
        resolved[
          requiredParameter
        ];

      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        missingRequired.push(
          requiredParameter
        );
      }
    }

    return {
      arguments: resolved,

      missingRequired,
    };
  }

  resolveOrThrow(
    input: ResolveArgumentsInput
  ): Record<string, unknown> {
    const result =
      this.resolve(input);

    if (
      result.missingRequired
        .length > 0
    ) {
      throw new Error(
        `Missing required arguments for "${input.tool.name}": ${result.missingRequired.join(", ")}`
      );
    }

    return result.arguments;
  }

  private resolveParameter(
    parameterName: string,
    context: McpArgumentContext,
    userFields: DecomposedBirthProfile,
    partnerFields: DecomposedBirthProfile
  ): unknown {
    /*
     * First priority:
     * explicitly supplied request values.
     */
    const explicitValue =
      context.extras?.[
        parameterName
      ];

    if (
      explicitValue !== undefined &&
      explicitValue !== null &&
      explicitValue !== ""
    ) {
      return explicitValue;
    }

    const pairMatch =
      PAIR_PREFIXES.find((prefix) =>
        prefix.pattern.test(
          parameterName
        )
      );

    if (pairMatch) {
      const remainder =
        parameterName.replace(
          pairMatch.pattern,
          ""
        );

      const person =
        pairMatch.person === "user"
          ? context.user
          : context.partner;

      const fields =
        pairMatch.person === "user"
          ? userFields
          : partnerFields;

      if (!person) {
        return undefined;
      }

      return this.resolveCanonicalField(
        remainder,
        person,
        fields
      );
    }

    return this.resolveCanonicalField(
      parameterName,
      context.user,
      userFields
    );
  }

  /**
   * Maps a (prefix-stripped) parameter name to a value for a
   * single person, covering both the live server's real
   * schema (day/month/year/hour/min/lat/lon/tzone, ...) and
   * the legacy static-catalog schema (dateOfBirth,
   * timeOfBirth, latitude, longitude, timezone, ...) so the
   * fallback catalog still mostly works if live sync fails.
   */
  private resolveCanonicalField(
    parameterName: string,
    person: AstrologyPersonContext,
    fields: DecomposedBirthProfile
  ): unknown {
    switch (
      parameterName.toLowerCase()
    ) {
      case "day":
      case "date":
        return fields.day;

      case "month":
        return fields.month;

      case "year":
        return fields.year;

      case "hour":
        return fields.hour;

      case "min":
        return fields.min;

      case "lat":
      case "latitude":
        return fields.lat;

      case "lon":
      case "long":
      case "longitude":
        return fields.lon;

      case "tzone":
        return fields.tzone;

      case "timezone":
      case "country_code":
        return fields.timezoneName;

      case "place":
      case "placeofbirth":
        return (
          person.place ??
          fields.place
        );

      case "name":
        return person.name;

      case "full_name":
      case "fullname":
        return person.name;

      /*
       * Legacy static-catalog fields only — the live server
       * doesn't use these, but the fallback catalog does.
       */
      case "dateofbirth":
        return fields.dateOfBirthIso;

      case "timeofbirth":
        return fields.timeOfBirthRaw;

      default:
        return undefined;
    }
  }

  private normalizeSchema(
    inputSchema: unknown
  ): JsonSchema {
    if (
      typeof inputSchema !==
        "object" ||
      inputSchema === null
    ) {
      return {};
    }

    const schema =
      inputSchema as JsonSchema;

    return schema;
  }
}
