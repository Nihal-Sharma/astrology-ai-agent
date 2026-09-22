import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { useAuthFlow } from "./src/hooks/useAuthFlow";
import { PhoneScreen } from "./src/screens/PhoneScreen";
import { OtpScreen } from "./src/screens/OtpScreen";
import { NameScreen } from "./src/screens/NameScreen";
import { BirthProfileScreen } from "./src/screens/BirthProfileScreen";
import { HomeScreen } from "./src/screens/HomeScreen";

export default function App() {
  const {
    stage,
    error,
    busy,
    submitPhone,
    submitOtp,
    submitName,
    submitBirthProfile,
    logout,
    backToPhone,
  } = useAuthFlow();

  return (
    <>
      {stage.name === "loading" && (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0b0f19",
          }}
        >
          <ActivityIndicator color="#6c5ce7" />
        </View>
      )}

      {stage.name === "phone" && (
        <PhoneScreen
          busy={busy}
          error={error}
          onSubmit={submitPhone}
        />
      )}

      {stage.name === "otp" && (
        <OtpScreen
          phoneNumber={stage.phoneNumber}
          busy={busy}
          error={error}
          onSubmit={(otp) =>
            submitOtp(stage.phoneNumber, otp)
          }
          onBack={backToPhone}
        />
      )}

      {stage.name === "onboarding-name" && (
        <NameScreen
          busy={busy}
          error={error}
          onSubmit={(name) =>
            submitName(stage.token, stage.user, name)
          }
        />
      )}

      {stage.name === "onboarding-birth" && (
        <BirthProfileScreen
          token={stage.token}
          busy={busy}
          error={error}
          onSubmit={(input) =>
            submitBirthProfile(
              stage.token,
              stage.user,
              input
            )
          }
        />
      )}

      {stage.name === "home" && (
        <HomeScreen
          user={stage.user}
          token={stage.token}
          onLogout={logout}
        />
      )}

      <StatusBar style="light" />
    </>
  );
}
