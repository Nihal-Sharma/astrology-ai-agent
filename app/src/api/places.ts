import { apiRequest } from "./client";

/**
 * Place search itself happens on-device (`expo-location`'s
 * native geocoder — see PlaceSearchInput.tsx) — no API key, no
 * server round trip for that part. This is the one server call
 * left in the flow: resolving the coordinates *that* geocoder
 * returned to an IANA timezone, via an offline lookup
 * (`tz-lookup`, see server/src/modules/places). Keeping it
 * server-side keeps the lookup table out of the app bundle and
 * matches "the app never has to work out a timezone itself".
 */
export function getTimezone(
  latitude: number,
  longitude: number,
  token: string
): Promise<{ timezone: string }> {
  return apiRequest(
    `/places/timezone?latitude=${latitude}&longitude=${longitude}`,
    { token }
  );
}
