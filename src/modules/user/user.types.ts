import { Types } from "mongoose";

export interface User {
  _id: Types.ObjectId;

  email: string;

  name?: string;

  avatarUrl?: string;

  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
  isActive?: boolean;
}