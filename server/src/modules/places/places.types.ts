export interface ResolvedTimezone {
  /**
   * IANA zone id, e.g. "Asia/Kolkata" — same format the
   * `BirthProfile.timezone` field already expects.
   */
  timezone: string;
}
