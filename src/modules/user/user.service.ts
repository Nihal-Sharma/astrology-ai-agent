import {
  CreateUserInput,
  UpdateUserInput,
  User,
} from "./user.types";

import { UserRepository } from "./user.repository";

export class UserService {
  constructor(
    private readonly repository: UserRepository
  ) {}

  async createUser(
    input: CreateUserInput
  ): Promise<User> {
    const existingUser =
      await this.repository.findByEmail(
        input.email
      );

    if (existingUser) {
      throw new Error(
        "A user with this email already exists"
      );
    }

    const user =
      await this.repository.create(input);

    return this.sanitize(
      user.toObject()
    );
  }

  async getUserById(
    userId: string
  ): Promise<User | null> {
    const user =
      await this.repository.findById(userId);

    return user
      ? this.sanitize(user.toObject())
      : null;
  }

  async getUserByEmail(
    email: string
  ): Promise<User | null> {
    const user =
      await this.repository.findByEmail(email);

    return user
      ? this.sanitize(user.toObject())
      : null;
  }

  /**
   * `passwordHash` is `select: false` at the schema level, but
   * findByEmail explicitly re-selects it for AuthService's
   * login/registration use — strip it back out before returning
   * a `User` to anything outside that flow.
   */
  private sanitize(user: User): User {
    const {
      passwordHash: _passwordHash,
      ...rest
    } = user;

    return rest as User;
  }

  async updateUser(
    userId: string,
    input: UpdateUserInput
  ): Promise<User | null> {
    const user =
      await this.repository.updateById(
        userId,
        input
      );

    return user
      ? this.sanitize(user.toObject())
      : null;
  }

  async deleteUser(
    userId: string
  ): Promise<boolean> {
    return this.repository.deleteById(userId);
  }
}