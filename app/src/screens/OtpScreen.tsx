import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { styles } from "./styles";

interface Props {
  phoneNumber: string;
  busy: boolean;
  error: string | null;
  onSubmit: (otp: string) => void;
  onBack: () => void;
}

export function OtpScreen({
  phoneNumber,
  busy,
  error,
  onSubmit,
  onBack,
}: Props) {
  const [otp, setOtp] = useState("");

  const canSubmit = otp.trim().length === 4 && !busy;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Enter the code
      </Text>

      <Text style={styles.subtitle}>
        We sent a 4-digit code to {phoneNumber}.
      </Text>

      <Text style={styles.label}>
        OTP
      </Text>

      <TextInput
        style={styles.input}
        value={otp}
        onChangeText={setOtp}
        placeholder="1234"
        placeholderTextColor="#5a6178"
        keyboardType="number-pad"
        maxLength={4}
        autoFocus
        onSubmitEditing={() =>
          canSubmit && onSubmit(otp.trim())
        }
      />

      <Text style={styles.hint}>
        Dev mode — the OTP is always 1234, no SMS is sent.
      </Text>

      <Pressable
        style={[
          styles.button,
          !canSubmit && styles.buttonDisabled,
        ]}
        disabled={!canSubmit}
        onPress={() => onSubmit(otp.trim())}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>
            Verify
          </Text>
        )}
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={onBack}
        disabled={busy}
      >
        <Text style={styles.secondaryButtonText}>
          Change phone number
        </Text>
      </Pressable>

      {error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
}
