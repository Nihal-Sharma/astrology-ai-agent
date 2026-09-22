import { describe, expect, it } from "vitest";

import { PlacesService } from "../../src/modules/places/places.service";
import { logger } from "../../src/infrastructure/observability/logger";
import { AppError } from "../../src/shared/errors/app-error";

describe("PlacesService.resolveTimezone", () => {
  const service = new PlacesService(logger);

  it("resolves a well-known coordinate to its IANA timezone", async () => {
    // Jaipur, Rajasthan, India
    const result = await service.resolveTimezone(
      26.9124,
      75.7873
    );

    expect(result).toEqual({
      timezone: "Asia/Kolkata",
    });
  });

  it("resolves coordinates across other continents", async () => {
    // New York, USA
    await expect(
      service.resolveTimezone(40.7128, -74.006)
    ).resolves.toEqual({
      timezone: "America/New_York",
    });

    // London, UK
    await expect(
      service.resolveTimezone(51.5074, -0.1278)
    ).resolves.toEqual({
      timezone: "Europe/London",
    });
  });

  it("rejects an out-of-range latitude", async () => {
    await expect(
      service.resolveTimezone(120, 0)
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects an out-of-range longitude", async () => {
    await expect(
      service.resolveTimezone(0, 200)
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a non-finite coordinate", async () => {
    await expect(
      service.resolveTimezone(Number.NaN, 0)
    ).rejects.toBeInstanceOf(AppError);
  });
});
