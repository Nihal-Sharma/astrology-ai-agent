import {
  BirthProfile,
} from "../birth-profile";

export interface AstrologyPerson {
  birthProfile?:
    | BirthProfile
    | null;

  name?: string;

  place?: string;
}

export interface AstrologyExecutionInput {
  userId: string;

  conversationId: string;

  message: string;

  user?: AstrologyPerson;

  birthProfile?: BirthProfile | null;

  partner?: AstrologyPerson;

  /**
   * For transit/predictive questions — see
   * `buildTargetDateExtras` for how these get translated into
   * the various provider-specific extra parameter names.
   */
  targetDate?: string | null;

  targetRangeDays?: number | null;

  extras?: Record<
    string,
    unknown
  >;

  signal?: AbortSignal;
}

export interface AstrologyExecutionOutput {
  results: Array<{
    toolName: string;

    success: boolean;

    content: unknown[];

    isError?: boolean;

    executionTimeMs: number;

    error?: string;
  }>;
}