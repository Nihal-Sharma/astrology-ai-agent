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
  busy: boolean;
  error: string | null;
  onSubmit: (phoneNumber: string) => void;
}

export function PhoneScreen({
  busy,
  error,
  onSubmit,
}: Props) {
  const [phoneNumber, setPhoneNumber] = useState("");

  const canSubmit =
    phoneNumber.trim().length >= 7 && !busy;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Welcome
      </Text>

      <Text style={styles.subtitle}>
        Enter your phone number to sign in or create an
        account.
      </Text>

      <Text style={styles.label}>
        Phone number
      </Text>

      <TextInput
        style={styles.input}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        placeholder="+91 98765 43210"
        placeholderTextColor="#5a6178"
        keyboardType="phone-pad"
        autoFocus
        onSubmitEditing={() =>
          canSubmit && onSubmit(phoneNumber.trim())
        }
      />

      <Pressable
        style={[
          styles.button,
          !canSubmit && styles.buttonDisabled,
        ]}
        disabled={!canSubmit}
        onPress={() => onSubmit(phoneNumber.trim())}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>
            Send OTP
          </Text>
        )}
      </Pressable>

      {error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
}
