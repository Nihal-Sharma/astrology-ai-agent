import { Types } from "mongoose";

import {
  UserModel,
  UserDocument,
} from "./user.model";

import {
  CreateUserInput,
  UpdateUserInput,
} from "./user.types";

export class UserRepository {
  async create(
    input: CreateUserInput
  ): Promise<UserDocument> {
    return UserModel.create(input);
  }

  async findById(
    userId: string
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    return UserModel.findById(userId).exec();
  }

  /**
   * Explicitly selects `passwordHash` (schema-level
   * `select: false`) — the only two callers are
   * AuthService.register (uniqueness check) and
   * AuthService.login (credential verification).
   */
  async findByEmail(
    email: string
  ): Promise<UserDocument | null> {
    return UserModel.findOne({
      email: email.toLowerCase().trim(),
    })
      .select("+passwordHash")
      .exec();
  }

  async updateById(
    userId: string,
    input: UpdateUserInput
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    return UserModel.findByIdAndUpdate(
      userId,
      {
        $set: input,
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).exec();
  }

  async deleteById(
    userId: string
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }

    const result = await UserModel.deleteOne({
      _id: userId,
    }).exec();

    return result.deletedCount === 1;
  }
}