import { describe, expect, it } from "vitest";

import {
  isEnglishOrHindi,
  isHindiScript,
} from "../../src/shared/utils/language";

describe("isEnglishOrHindi", () => {
  it("accepts plain English", () => {
    expect(
      isEnglishOrHindi(
        "Your Jupiter placement suggests a period of growth this year."
      )
    ).toBe(true);
  });

  it("accepts Hindi in Devanagari script", () => {
    expect(
      isEnglishOrHindi(
        "आपका बृहस्पति ग्रह इस वर्ष विकास की अवधि दर्शाता है।"
      )
    ).toBe(true);
  });

  it("accepts Hinglish (Hindi written in Latin script)", () => {
    expect(
      isEnglishOrHindi(
        "Aapka mangal dasha thoda mushkil ho sakta hai is saal."
      )
    ).toBe(true);
  });

  it("accepts English/Hindi mixed in one sentence", () => {
    expect(
      isEnglishOrHindi(
        "Your Saturn यानी शनि is in the 10th house right now."
      )
    ).toBe(true);
  });

  it("accepts empty or punctuation/number-only text", () => {
    expect(isEnglishOrHindi("")).toBe(true);
    expect(isEnglishOrHindi("12:30, 2026!")).toBe(
      true
    );
  });

  it("rejects Urdu script", () => {
    expect(
      isEnglishOrHindi(
        "آپ کا مشتری اس سال ترقی کی مدت کی نشاندہی کرتا ہے۔"
      )
    ).toBe(false);
  });

  it("rejects Arabic", () => {
    expect(
      isEnglishOrHindi(
        "كوكب المشتري يشير إلى فترة نمو هذا العام."
      )
    ).toBe(false);
  });

  it("rejects Chinese", () => {
    expect(
      isEnglishOrHindi(
        "你的木星位置表明今年是成长的时期。"
      )
    ).toBe(false);
  });

  it("rejects Tamil", () => {
    expect(
      isEnglishOrHindi(
        "உங்கள் வியாழன் நிலை இந்த ஆண்டு வளர்ச்சியைக் குறிக்கிறது."
      )
    ).toBe(false);
  });

  it("tolerates a single stray foreign-script character in an otherwise long English sentence", () => {
    expect(
      isEnglishOrHindi(
        "This is a long English sentence about your birth chart and today's ك transit, mostly written in plain English with just one stray character."
      )
    ).toBe(true);
  });
});

describe("isHindiScript", () => {
  it("accepts Hindi in Devanagari script", () => {
    expect(
      isHindiScript(
        "आपका बृहस्पति ग्रह इस वर्ष विकास की अवधि दर्शाता है।"
      )
    ).toBe(true);
  });

  it("accepts empty or punctuation/number-only text", () => {
    expect(isHindiScript("")).toBe(true);
    expect(isHindiScript("12:30, 2026!")).toBe(true);
  });

  it("rejects plain English", () => {
    expect(
      isHindiScript(
        "Your Jupiter placement suggests a period of growth this year."
      )
    ).toBe(false);
  });

  it("rejects Hinglish (Hindi written in Latin script) — display translation should normalize it to Devanagari", () => {
    expect(
      isHindiScript(
        "Aapka mangal dasha thoda mushkil ho sakta hai is saal."
      )
    ).toBe(false);
  });

  it("rejects Urdu script", () => {
    expect(
      isHindiScript(
        "آپ کا مشتری اس سال ترقی کی مدت کی نشاندہی کرتا ہے۔"
      )
    ).toBe(false);
  });
});
