import tzlookup from "tz-lookup";

import {
  AppLogger,
} from "../../infrastructure/observability/logger";

import {
  AppError,
} from "../../shared/errors/app-error";

import {
  ResolvedTimezone,
} from "./places.types";

/**
 * Resolves a coordinate pair to an IANA timezone entirely
 * offline — a local lossy-compressed timezone-boundary lookup
 * (`tz-lookup`), not a Google/third-party API call. No API key,
 * no network dependency, no cost. The app resolves the place
 * name itself on-device (`expo-location`'s native geocoder) and
 * only sends this server the resulting coordinates, so the user
 * never types/sees latitude/longitude and the server never
 * receives a raw place-name query.
 */
export class PlacesService {
  constructor(
    private readonly logger: AppLogger
  ) {}

  async resolveTimezone(
    latitude: number,
    longitude: number
  ): Promise<ResolvedTimezone> {
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new AppError(
        "latitude must be a number between -90 and 90",
        400
      );
    }

    if (
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new AppError(
        "longitude must be a number between -180 and 180",
        400
      );
    }

    try {
      const timezone = tzlookup(
        latitude,
        longitude
      );

      return { timezone };
    } catch (error) {
      this.logger.error(
        {
          err: error,
          module: "places",
          latitude,
          longitude,
        },
        "Timezone lookup failed"
      );

      throw new AppError(
        "Could not determine a timezone for those coordinates",
        422
      );
    }
  }
}
