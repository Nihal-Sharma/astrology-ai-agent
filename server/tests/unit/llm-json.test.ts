import { describe, expect, it } from "vitest";

import { stripJsonCodeFence } from "../../src/shared/utils/llm-json";

describe("stripJsonCodeFence", () => {
  it("strips a ```json ... ``` fence", () => {
    expect(
      stripJsonCodeFence(
        '```json\n{"a":1}\n```'
      )
    ).toBe('{"a":1}');
  });

  it("strips a bare ``` ... ``` fence with no language tag", () => {
    expect(
      stripJsonCodeFence(
        '```\n{"a":1}\n```'
      )
    ).toBe('{"a":1}');
  });

  it("leaves plain JSON (no fence) untouched", () => {
    expect(
      stripJsonCodeFence('{"a":1}')
    ).toBe('{"a":1}');
  });

  it("trims surrounding whitespace around a fence", () => {
    expect(
      stripJsonCodeFence(
        '  \n```json\n{"a":1}\n```\n  '
      )
    ).toBe('{"a":1}');
  });

  it("handles a fenced object spanning multiple lines", () => {
    const input =
      '```json\n{\n  "a": 1,\n  "b": 2\n}\n```';

    expect(
      stripJsonCodeFence(input)
    ).toBe(
      '{\n  "a": 1,\n  "b": 2\n}'
    );
  });
});
