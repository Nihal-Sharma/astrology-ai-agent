import { useState } from "react";
import {
  ActivityIndicator,
  Text,
  TextInput,
  View,
} from "react-native";

import * as Location from "expo-location";

import { styles } from "./styles";
import { getTimezone } from "../api/places";

export interface ResolvedPlace {
  latitude: number;
  longitude: number;
  timezone: string;
}

interface Props {
  token: string;
  onResolved: (
    resolved: ResolvedPlace,
    label: string
  ) => void;
}

/**
 * Resolves a typed place name on-device via the phone's native
 * geocoder (`expo-location` — Apple/Google Maps under the hood,
 * no API key), then asks the server for the timezone at those
 * coordinates. No live-as-you-type suggestions (the native
 * geocoder doesn't do predictive search like Google Places
 * Autocomplete did) — instead this resolves once, when the user
 * finishes typing and moves on (onBlur).
 */
export function PlaceSearchInput({
  token,
  onResolved,
}: Props) {
  const [query, setQuery] = useState("");
  const [resolvedLabel, setResolvedLabel] = useState<
    string | null
  >(null);

  /**
   * The raw query text that `resolvedLabel` was resolved from —
   * compared against on blur so re-focusing/blurring the field
   * without changing the text doesn't trigger a redundant
   * geocode + timezone round trip.
   */
  const [resolvedQuery, setResolvedQuery] = useState<
    string | null
  >(null);

  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(
    null
  );

  function buildLabel(
    address: Location.LocationGeocodedAddress
  ): string {
    if (address.formattedAddress) {
      return address.formattedAddress;
    }

    return [
      address.name,
      address.city,
      address.region,
      address.country,
    ]
      .filter(Boolean)
      .join(", ");
  }

  async function resolve() {
    const trimmed = query.trim();

    if (!trimmed || trimmed === resolvedQuery) {
      return;
    }

    setResolving(true);
    setError(null);

    try {
      const permission =
        await Location.getForegroundPermissionsAsync();

      let granted = permission.granted;

      if (!granted && permission.canAskAgain) {
        const requested =
          await Location.requestForegroundPermissionsAsync();

        granted = requested.granted;
      }

      if (!granted) {
        setError(
          "Location permission is needed to look up a place — enable it for this app in your phone's Settings, then try again."
        );
        return;
      }

      const geocoded = await Location.geocodeAsync(
        trimmed
      );

      const first = geocoded[0];

      if (!first) {
        setError(
          "Could not find that place — try adding a city, state, or country."
        );
        return;
      }

      const [address] =
        await Location.reverseGeocodeAsync({
          latitude: first.latitude,
          longitude: first.longitude,
        });

      const label = address
        ? buildLabel(address)
        : trimmed;

      const { timezone } = await getTimezone(
        first.latitude,
        first.longitude,
        token
      );

      setResolvedLabel(label);
      setResolvedQuery(trimmed);

      onResolved(
        {
          latitude: first.latitude,
          longitude: first.longitude,
          timezone,
        },
        label
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not resolve that place"
      );
    } finally {
      setResolving(false);
    }
  }

  return (
    <View>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={(text) => {
          setQuery(text);

          if (text.trim() !== resolvedQuery) {
            setResolvedLabel(null);
            setResolvedQuery(null);
          }
        }}
        onBlur={resolve}
        placeholder="City, state, country…"
        placeholderTextColor="#5a6178"
      />

      {resolving && (
        <ActivityIndicator
          style={{ marginTop: 8 }}
          color="#6c5ce7"
        />
      )}

      {!resolving && resolvedLabel && (
        <Text style={styles.hint}>
          ✓ Resolved: {resolvedLabel}
        </Text>
      )}

      {error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
}
