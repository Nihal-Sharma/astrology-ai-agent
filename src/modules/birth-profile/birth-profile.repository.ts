import { Types } from "mongoose";

import {
  BirthProfileModel,
  BirthProfileDocument,
} from "./birth-profile.model";

import {
  CreateBirthProfileInput,
  UpdateBirthProfileInput,
} from "./birth-profile.types";

export class BirthProfileRepository {
  async create(
    input: CreateBirthProfileInput
  ): Promise<BirthProfileDocument> {
    return BirthProfileModel.create({
      ...input,
      userId: new Types.ObjectId(input.userId),
    });
  }

  async findByUserId(
    userId: string
  ): Promise<BirthProfileDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    return BirthProfileModel.findOne({
      userId,
    }).exec();
  }

  async findById(
    birthProfileId: string
  ): Promise<BirthProfileDocument | null> {
    if (
      !Types.ObjectId.isValid(
        birthProfileId
      )
    ) {
      return null;
    }

    return BirthProfileModel.findById(
      birthProfileId
    ).exec();
  }

  async updateByUserId(
    userId: string,
    input: UpdateBirthProfileInput
  ): Promise<BirthProfileDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    return BirthProfileModel.findOneAndUpdate(
      { userId },
      {
        $set: input,
      },
      {
        new: true,
        runValidators: true,
      }
    ).exec();
  }

  async deleteByUserId(
    userId: string
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }

    const result =
      await BirthProfileModel.deleteOne({
        userId,
      }).exec();

    return result.deletedCount === 1;
  }
}