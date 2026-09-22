import { apiRequest } from "./client";

export interface Conversation {
  _id: string;
  userId: string;
  title?: string;
  status: string;
}

export function createConversation(
  userId: string,
  token: string,
  title?: string
): Promise<Conversation> {
  return apiRequest(`/users/${userId}/conversations`, {
    method: "POST",
    token,
    body: { title },
  });
}
