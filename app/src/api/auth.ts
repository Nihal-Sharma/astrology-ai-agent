import { apiRequest, ApiError } from "./client";

export interface AuthUser {
  _id: string;
  phoneNumber?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  isActive: boolean;

  /**
   * Subscription tier — see the server's VoicePlan (user.types.ts).
   * Optional here only for safety against a stale cached user
   * object from before this field existed; the server always sends
   * it (defaults to "free").
   */
  plan?: "free" | "gold" | "diamond";

  createdAt: string;
  updatedAt: string;
}

export interface VerifyOtpResponse {
  user: AuthUser;
  token: string;
  isNewUser: boolean;
}

export function requestOtp(
  phoneNumber: string
): Promise<{ message: string }> {
  return apiRequest("/auth/otp/request", {
    method: "POST",
    body: { phoneNumber },
  });
}

export function verifyOtp(
  phoneNumber: string,
  otp: string
): Promise<VerifyOtpResponse> {
  return apiRequest("/auth/otp/verify", {
    method: "POST",
    body: { phoneNumber, otp },
  });
}

export function getUser(
  userId: string,
  token: string
): Promise<AuthUser> {
  return apiRequest(`/users/${userId}`, { token });
}

export function updateUserName(
  userId: string,
  token: string,
  name: string
): Promise<AuthUser> {
  return apiRequest(`/users/${userId}`, {
    method: "PATCH",
    token,
    body: { name },
  });
}

export interface BirthProfile {
  _id: string;
  userId: string;
  dateOfBirth: string;
  timeOfBirth: string;
  placeOfBirth: string;
  latitude: number;
  longitude: number;
  timezone: string;
  timeOfBirthVerified: boolean;
}

export interface CreateBirthProfileInput {
  dateOfBirth: string;
  timeOfBirth: string;
  placeOfBirth: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export function createBirthProfile(
  userId: string,
  token: string,
  input: CreateBirthProfileInput
): Promise<BirthProfile> {
  return apiRequest(`/users/${userId}/birth-profile`, {
    method: "POST",
    token,
    body: input,
  });
}

export async function getBirthProfile(
  userId: string,
  token: string
): Promise<BirthProfile | null> {
  try {
    return await apiRequest(
      `/users/${userId}/birth-profile`,
      { token }
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
