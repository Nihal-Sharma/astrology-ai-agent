import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";

import { styles } from "./styles";
import {
  PlaceSearchInput,
  ResolvedPlace,
} from "./PlaceSearchInput";
import { CreateBirthProfileInput } from "../api/auth";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTimeDisplay(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  token: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: CreateBirthProfileInput) => void;
}

export function BirthProfileScreen({
  token,
  busy,
  error,
  onSubmit,
}: Props) {
  const [dateOfBirth, setDateOfBirth] = useState<
    Date | null
  >(null);

  const [timeOfBirth, setTimeOfBirth] = useState<
    Date | null
  >(null);

  const [showIosDatePicker, setShowIosDatePicker] =
    useState(false);

  const [showIosTimePicker, setShowIosTimePicker] =
    useState(false);

  const [placeDescription, setPlaceDescription] =
    useState("");

  const [resolvedPlace, setResolvedPlace] = useState<
    ResolvedPlace | null
  >(null);

  const canSubmit = useMemo(
    () =>
      !busy &&
      dateOfBirth !== null &&
      timeOfBirth !== null &&
      resolvedPlace !== null,
    [busy, dateOfBirth, timeOfBirth, resolvedPlace]
  );

  function openDatePicker() {
    const initial = dateOfBirth ?? new Date(2000, 0, 1);

    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initial,
        mode: "date",
        maximumDate: new Date(),

        onValueChange: (_event, selectedDate) => {
          setDateOfBirth(selectedDate);
        },
      });

      return;
    }

    setShowIosDatePicker(true);
  }

  function openTimePicker() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: timeOfBirth ?? new Date(),
        mode: "time",
        is24Hour: true,

        onValueChange: (_event, selectedDate) => {
          setTimeOfBirth(selectedDate);
        },
      });

      return;
    }

    setShowIosTimePicker(true);
  }

  function handleSubmit() {
    if (
      !dateOfBirth ||
      !timeOfBirth ||
      !resolvedPlace
    ) {
      return;
    }

    onSubmit({
      dateOfBirth: formatDate(dateOfBirth),
      timeOfBirth: formatTime(timeOfBirth),
      placeOfBirth: placeDescription,
      latitude: resolvedPlace.latitude,
      longitude: resolvedPlace.longitude,
      timezone: resolvedPlace.timezone,
    });
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 64 }}
    >
      <Text style={styles.title}>
        Your birth details
      </Text>

      <Text style={styles.subtitle}>
        Used for your astrology chart — accuracy matters
        most for the exact time.
      </Text>

      <Text style={styles.label}>
        Date of birth
      </Text>

      <Pressable
        style={styles.input}
        onPress={openDatePicker}
      >
        <Text
          style={{
            color: dateOfBirth
              ? "#f5f7ff"
              : "#5a6178",
            fontSize: 16,
          }}
        >
          {dateOfBirth
            ? formatDateDisplay(dateOfBirth)
            : "Select date of birth"}
        </Text>
      </Pressable>

      {Platform.OS === "ios" &&
        showIosDatePicker && (
          <DateTimePicker
            value={dateOfBirth ?? new Date(2000, 0, 1)}
            mode="date"
            display="spinner"
            maximumDate={new Date()}
            onValueChange={(_event, selectedDate) => {
              setDateOfBirth(selectedDate);
            }}
            onDismiss={() =>
              setShowIosDatePicker(false)
            }
          />
        )}

      <Text style={styles.label}>
        Time of birth
      </Text>

      <Pressable
        style={styles.input}
        onPress={openTimePicker}
      >
        <Text
          style={{
            color: timeOfBirth
              ? "#f5f7ff"
              : "#5a6178",
            fontSize: 16,
          }}
        >
          {timeOfBirth
            ? formatTimeDisplay(timeOfBirth)
            : "Select time of birth"}
        </Text>
      </Pressable>

      {Platform.OS === "ios" &&
        showIosTimePicker && (
          <DateTimePicker
            value={timeOfBirth ?? new Date()}
            mode="time"
            display="spinner"
            onValueChange={(_event, selectedDate) => {
              setTimeOfBirth(selectedDate);
            }}
            onDismiss={() =>
              setShowIosTimePicker(false)
            }
          />
        )}

      <Text style={styles.label}>
        Place of birth
      </Text>

      <PlaceSearchInput
        token={token}
        onResolved={(resolved, label) => {
          setResolvedPlace(resolved);
          setPlaceDescription(label);
        }}
      />

      {resolvedPlace && (
        <Text style={styles.hint}>
          Timezone: {resolvedPlace.timezone}
        </Text>
      )}

      <Pressable
        style={[
          styles.button,
          !canSubmit && styles.buttonDisabled,
        ]}
        disabled={!canSubmit}
        onPress={handleSubmit}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>
            Finish
          </Text>
        )}
      </Pressable>

      {error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </ScrollView>
  );
}
