import { useCallback, useEffect, useState } from "react";

import {
  AuthUser,
  createBirthProfile,
  CreateBirthProfileInput,
  getBirthProfile,
  getUser,
  requestOtp,
  updateUserName,
  verifyOtp,
} from "../api/auth";

import { tokenStorage } from "../storage";
import { decodeJwtPayload } from "../utils/jwt";

export type Stage =
  | { name: "loading" }
  | { name: "phone" }
  | { name: "otp"; phoneNumber: string }
  | { name: "onboarding-name"; token: string; user: AuthUser }
  | { name: "onboarding-birth"; token: string; user: AuthUser }
  | { name: "home"; token: string; user: AuthUser };

/**
 * Decides the next screen after we have a valid token+user: name
 * first (if missing), then birth profile, then home. Re-run after
 * every onboarding step and on cold start, so a user who drops
 * off mid-onboarding picks up where they left off.
 */
async function resolveStageAfterAuth(
  token: string,
  user: AuthUser
): Promise<Stage> {
  if (!user.name) {
    return { name: "onboarding-name", token, user };
  }

  const birthProfile = await getBirthProfile(
    user._id,
    token
  );

  if (!birthProfile) {
    return { name: "onboarding-birth", token, user };
  }

  return { name: "home", token, user };
}

export function useAuthFlow() {
  const [stage, setStage] = useState<Stage>({
    name: "loading",
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await tokenStorage.get();
      const payload = token
        ? decodeJwtPayload(token)
        : null;

      if (!token || !payload) {
        setStage({ name: "phone" });
        return;
      }

      try {
        const user = await getUser(
          payload.userId,
          token
        );

        setStage(
          await resolveStageAfterAuth(token, user)
        );
      } catch {
        // Expired/invalid token, or server unreachable — fall
        // back to a fresh login rather than getting stuck.
        await tokenStorage.clear();
        setStage({ name: "phone" });
      }
    })();
  }, []);

  const submitPhone = useCallback(
    async (phoneNumber: string) => {
      setBusy(true);
      setError(null);

      try {
        await requestOtp(phoneNumber);
        setStage({ name: "otp", phoneNumber });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not send OTP"
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const submitOtp = useCallback(
    async (phoneNumber: string, otp: string) => {
      setBusy(true);
      setError(null);

      try {
        const result = await verifyOtp(
          phoneNumber,
          otp
        );

        await tokenStorage.set(result.token);

        setStage(
          await resolveStageAfterAuth(
            result.token,
            result.user
          )
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Invalid OTP"
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const submitName = useCallback(
    async (
      token: string,
      user: AuthUser,
      name: string
    ) => {
      setBusy(true);
      setError(null);

      try {
        const updated = await updateUserName(
          user._id,
          token,
          name
        );

        setStage(
          await resolveStageAfterAuth(
            token,
            updated
          )
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not save your name"
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const submitBirthProfile = useCallback(
    async (
      token: string,
      user: AuthUser,
      input: CreateBirthProfileInput
    ) => {
      setBusy(true);
      setError(null);

      try {
        await createBirthProfile(
          user._id,
          token,
          input
        );

        setStage({ name: "home", token, user });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not save your birth details"
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    await tokenStorage.clear();
    setError(null);
    setStage({ name: "phone" });
  }, []);

  const backToPhone = useCallback(() => {
    setError(null);
    setStage({ name: "phone" });
  }, []);

  return {
    stage,
    error,
    busy,
    submitPhone,
    submitOtp,
    submitName,
    submitBirthProfile,
    logout,
    backToPhone,
  };
}
