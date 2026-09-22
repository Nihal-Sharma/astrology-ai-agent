import { Types } from "mongoose";

import {
  PartnerProfileModel,
  PartnerProfileDocument,
} from "./partner-profile.model";

import {
  CreatePartnerProfileInput,
  UpdatePartnerProfileInput,
} from "./partner-profile.types";

export class PartnerProfileRepository {
  async create(
    input: CreatePartnerProfileInput
  ): Promise<PartnerProfileDocument> {
    return PartnerProfileModel.create({
      ...input,
      conversationId: new Types.ObjectId(
        input.conversationId
      ),
      userId: new Types.ObjectId(input.userId),
    });
  }

  async findByConversationId(
    conversationId: string
  ): Promise<PartnerProfileDocument | null> {
    if (
      !Types.ObjectId.isValid(conversationId)
    ) {
      return null;
    }

    return PartnerProfileModel.findOne({
      conversationId,
    }).exec();
  }

  async updateByConversationId(
    conversationId: string,
    input: UpdatePartnerProfileInput
  ): Promise<PartnerProfileDocument | null> {
    if (
      !Types.ObjectId.isValid(conversationId)
    ) {
      return null;
    }

    return PartnerProfileModel.findOneAndUpdate(
      { conversationId },
      {
        $set: input,
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).exec();
  }

  async deleteByConversationId(
    conversationId: string
  ): Promise<boolean> {
    if (
      !Types.ObjectId.isValid(conversationId)
    ) {
      return false;
    }

    const result =
      await PartnerProfileModel.deleteOne({
        conversationId,
      }).exec();

    return result.deletedCount === 1;
  }

  /**
   * Cascade delete for account deletion — see §6 (Data
   * privacy). Partner profiles are the one collection here that
   * also contains a THIRD PARTY's birth data (someone who never
   * directly consented), not just the account holder's own —
   * deleting them when the account that added them is deleted
   * is the correct default.
   */
  async deleteByUserId(
    userId: string
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }

    await PartnerProfileModel.deleteMany(
      {
        userId,
      }
    ).exec();
  }
}
