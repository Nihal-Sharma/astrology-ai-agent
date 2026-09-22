import { Pressable, Text, View } from "react-native";

import { styles } from "./styles";
import { AuthUser } from "../api/auth";
import { useVoiceSession } from "../realtime/useVoiceSession";

interface Props {
  user: AuthUser;
  token: string;
  onLogout: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting…",
  ready: "Hold the button and speak",
  recording: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
  error: "Something went wrong",
};

export function HomeScreen({
  user,
  token,
  onLogout,
}: Props) {
  const {
    status,
    error,
    transcript,
    turnMode,
    startRecording,
    stopRecording,
  } = useVoiceSession({
    token,
    userId: user._id,
  });

  /*
   * "error" is included here too — e.g. a dropped connection or
   * a local playback failure — so a failure can never leave the
   * mic button permanently stuck disabled. Pressing it while the
   * connection is actually still down just surfaces that same
   * error again via stopRecording's own check, which is fine;
   * the point is the user is never stuck with no way to retry.
   */
  const canRecord =
    status === "ready" ||
    status === "recording" ||
    status === "error";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Welcome, {user.name}
      </Text>

      <View style={styles.planBadge}>
        <Text style={styles.planBadgeText}>
          {(user.plan ?? "free")}{" "}
          plan
        </Text>
      </View>

      <Text style={styles.subtitle}>
        {user.phoneNumber}
      </Text>

      {turnMode && (
        <Text style={styles.hint}>
          {turnMode.personaMode} · {turnMode.responseMode}
        </Text>
      )}

      {transcript && (
        <Text style={styles.hint}>
          You said: {transcript}
        </Text>
      )}

      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Pressable
          disabled={!canRecord}
          onPressIn={startRecording}
          onPressOut={stopRecording}
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              status === "recording"
                ? "#e74c3c"
                : "#6c5ce7",
            opacity: canRecord ? 1 : 0.5,
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            {status === "recording"
              ? "Release"
              : "Hold"}
          </Text>
        </Pressable>

        <Text
          style={[
            styles.subtitle,
            { marginTop: 24, textAlign: "center" },
          ]}
        >
          {STATUS_LABEL[status] ?? status}
        </Text>

        {error && (
          <Text style={styles.error}>{error}</Text>
        )}
      </View>

      <Pressable
        style={styles.button}
        onPress={onLogout}
      >
        <Text style={styles.buttonText}>
          Log out
        </Text>
      </Pressable>
    </View>
  );
}
