import {
  BirthProfileRepository,
} from "./birth-profile.repository";

import {
  CreateBirthProfileInput,
  UpdateBirthProfileInput,
  BirthProfile,
} from "./birth-profile.types";

import { UserService } from "../user/user.service";

export class BirthProfileService {
  constructor(
    private readonly repository: BirthProfileRepository,

    private readonly userService: UserService
  ) {}

  async createBirthProfile(
    input: CreateBirthProfileInput
  ): Promise<BirthProfile> {
    const user =
      await this.userService.getUserById(
        input.userId
      );

    if (!user) {
      throw new Error(
        "Cannot create birth profile for a user that does not exist"
      );
    }

    const existing =
      await this.repository.findByUserId(
        input.userId
      );

    if (existing) {
      throw new Error(
        "Birth profile already exists for this user"
      );
    }

    const profile =
      await this.repository.create(input);

    return profile.toObject();
  }

  async getBirthProfile(
    userId: string
  ): Promise<BirthProfile | null> {
    const profile =
      await this.repository.findByUserId(
        userId
      );

    return profile?.toObject() ?? null;
  }

  async updateBirthProfile(
    userId: string,
    input: UpdateBirthProfileInput
  ): Promise<BirthProfile | null> {
    const profile =
      await this.repository.updateByUserId(
        userId,
        input
      );

    return profile?.toObject() ?? null;
  }

  async deleteBirthProfile(
    userId: string
  ): Promise<boolean> {
    return this.repository.deleteByUserId(
      userId
    );
  }
}