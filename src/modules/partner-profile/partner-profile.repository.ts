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
        new: true,
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
}
