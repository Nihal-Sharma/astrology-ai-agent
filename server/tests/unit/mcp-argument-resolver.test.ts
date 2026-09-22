import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { McpArgumentResolver } from "../../src/modules/astrology/mcp/mcp.argument-resolver";
import { McpToolDefinition } from "../../src/modules/astrology/mcp/mcp.types";
import { BirthProfile } from "../../src/modules/birth-profile";

function makeBirthProfile(
  overrides: Partial<BirthProfile> = {}
): BirthProfile {
  const now = new Date();

  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    dateOfBirth: new Date("1995-06-15T00:00:00.000Z"),
    timeOfBirth: "14:30",
    placeOfBirth: "Mumbai, India",
    latitude: 19.076,
    longitude: 72.8777,
    timezone: "Asia/Kolkata",
    timeOfBirthVerified: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTool(
  properties: Record<string, { type?: string }>,
  required: string[]
): McpToolDefinition {
  return {
    name: "test_tool",
    description: "A test tool",
    inputSchema: {
      type: "object",
      properties,
      required,
    },
    source: "server",
    enabled: true,
    categories: [],
  };
}

describe("McpArgumentResolver", () => {
  const resolver = new McpArgumentResolver();

  it("resolves a natal-chart tool's canonical day/month/year/hour/min/lat/lon/tzone fields from a birth profile", () => {
    const tool = makeTool(
      {
        day: {},
        month: {},
        year: {},
        hour: {},
        min: {},
        lat: {},
        lon: {},
        tzone: {},
      },
      ["day", "month", "year", "hour", "min", "lat", "lon", "tzone"]
    );

    const result = resolver.resolve({
      tool,
      context: {
        user: { birthProfile: makeBirthProfile() },
      },
    });

    expect(result.missingRequired).toEqual([]);
    expect(result.arguments.day).toBe(15);
    expect(result.arguments.month).toBe(6);
    expect(result.arguments.year).toBe(1995);
    expect(result.arguments.hour).toBe(14);
    expect(result.arguments.min).toBe(30);
    expect(result.arguments.lat).toBeCloseTo(19.076, 5);
    expect(result.arguments.lon).toBeCloseTo(72.8777, 5);
    expect(typeof result.arguments.tzone).toBe("number");
  });

  it("reports missing required arguments instead of guessing, when no birth profile is available", () => {
    const tool = makeTool(
      { day: {}, month: {} },
      ["day", "month"]
    );

    const result = resolver.resolve({
      tool,
      context: { user: {} },
    });

    expect(result.missingRequired).toEqual(
      expect.arrayContaining(["day", "month"])
    );
  });

  it("resolves m_/f_ prefixed matchmaking fields to user/partner respectively", () => {
    const tool = makeTool(
      { m_day: {}, f_day: {} },
      ["m_day", "f_day"]
    );

    const result = resolver.resolve({
      tool,
      context: {
        user: {
          birthProfile: makeBirthProfile({
            dateOfBirth: new Date("1995-06-15T00:00:00.000Z"),
          }),
        },
        partner: {
          birthProfile: makeBirthProfile({
            dateOfBirth: new Date("1992-03-10T00:00:00.000Z"),
          }),
        },
      },
    });

    expect(result.arguments.m_day).toBe(15);
    expect(result.arguments.f_day).toBe(10);
  });

  it("reports a matchmaking field as missing when no partner profile is attached", () => {
    const tool = makeTool(
      { m_day: {}, f_day: {} },
      ["m_day", "f_day"]
    );

    const result = resolver.resolve({
      tool,
      context: {
        user: { birthProfile: makeBirthProfile() },
      },
    });

    expect(result.missingRequired).toContain("f_day");
  });

  it("prioritizes an explicit extra value (e.g. a resolved targetDate) over the birth profile", () => {
    const tool = makeTool(
      { dasha_date: {} },
      ["dasha_date"]
    );

    const result = resolver.resolve({
      tool,
      context: {
        user: { birthProfile: makeBirthProfile() },
        extras: { dasha_date: "2026-01-01" },
      },
    });

    expect(result.arguments.dasha_date).toBe("2026-01-01");
  });

  it("resolveOrThrow throws with the tool name and missing fields when required data is absent", () => {
    const tool = makeTool({ day: {} }, ["day"]);

    expect(() =>
      resolver.resolveOrThrow({
        tool,
        context: { user: {} },
      })
    ).toThrow(/test_tool/);
  });

  it("resolveOrThrow returns arguments directly when nothing is missing", () => {
    const tool = makeTool({ day: {} }, ["day"]);

    const args = resolver.resolveOrThrow({
      tool,
      context: { user: { birthProfile: makeBirthProfile() } },
    });

    expect(args.day).toBe(15);
  });
});
