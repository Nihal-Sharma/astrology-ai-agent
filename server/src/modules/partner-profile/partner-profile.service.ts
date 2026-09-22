import {
  PartnerProfileRepository,
} from "./partner-profile.repository";

import {
  CreatePartnerProfileInput,
  UpdatePartnerProfileInput,
  PartnerProfile,
} from "./partner-profile.types";

import { ConversationService } from "../conversation/conversation.service";

export class PartnerProfileService {
  constructor(
    private readonly repository: PartnerProfileRepository,

    private readonly conversationService: ConversationService
  ) {}

  async createPartnerProfile(
    input: CreatePartnerProfileInput
  ): Promise<PartnerProfile> {
    const conversation =
      await this.conversationService.getConversation(
        input.conversationId
      );

    if (!conversation) {
      throw new Error(
        "Cannot attach a partner profile to a conversation that does not exist"
      );
    }

    if (
      conversation.userId.toString() !==
      input.userId
    ) {
      throw new Error(
        "Conversation does not belong to this user"
      );
    }

    const existing =
      await this.repository.findByConversationId(
        input.conversationId
      );

    if (existing) {
      throw new Error(
        "A partner profile already exists for this conversation"
      );
    }

    const profile =
      await this.repository.create(input);

    return profile.toObject();
  }

  async getPartnerProfile(
    conversationId: string
  ): Promise<PartnerProfile | null> {
    const profile =
      await this.repository.findByConversationId(
        conversationId
      );

    return profile?.toObject() ?? null;
  }

  async updatePartnerProfile(
    conversationId: string,
    input: UpdatePartnerProfileInput
  ): Promise<PartnerProfile | null> {
    const profile =
      await this.repository.updateByConversationId(
        conversationId,
        input
      );

    return profile?.toObject() ?? null;
  }

  async deletePartnerProfile(
    conversationId: string
  ): Promise<boolean> {
    return this.repository.deleteByConversationId(
      conversationId
    );
  }
}
