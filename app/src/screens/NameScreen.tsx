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
  onSubmit: (name: string) => void;
}

export function NameScreen({
  busy,
  error,
  onSubmit,
}: Props) {
  const [name, setName] = useState("");

  const canSubmit = name.trim().length >= 2 && !busy;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        What should we call you?
      </Text>

      <Text style={styles.subtitle}>
        This is how your companion/astrologer will address
        you.
      </Text>

      <Text style={styles.label}>
        Name
      </Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor="#5a6178"
        autoFocus
        onSubmitEditing={() =>
          canSubmit && onSubmit(name.trim())
        }
      />

      <Pressable
        style={[
          styles.button,
          !canSubmit && styles.buttonDisabled,
        ]}
        disabled={!canSubmit}
        onPress={() => onSubmit(name.trim())}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>
            Continue
          </Text>
        )}
      </Pressable>

      {error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
}
