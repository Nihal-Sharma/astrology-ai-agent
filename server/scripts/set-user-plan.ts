/**
 * Sets a user's subscription plan directly in the database.
 *
 * This is the ONLY way to change a user's plan today — see
 * VoicePlan's doc comment (src/modules/user/user.types.ts) for why
 * it's deliberately not a self-service HTTP endpoint: there's no
 * billing/payment gate yet, so exposing this over HTTP would let
 * anyone grant themselves Gold/Diamond for free. Revisit once a
 * real billing integration exists (see ROADMAP.md's "explicitly
 * out of scope" section).
 *
 * Usage:
 *   npx tsx scripts/set-user-plan.ts <phoneNumber|userId> <free|gold|diamond>
 *
 * Example:
 *   npx tsx scripts/set-user-plan.ts +919876543210 gold
 */

import { config } from "../src/app/config";
import { logger } from "../src/infrastructure/observability/logger";
import { MongoDatabase } from "../src/infrastructure/database";
import { UserRepository } from "../src/modules/user/user.repository";
import { UserService } from "../src/modules/user/user.service";
import { VoicePlan } from "../src/modules/user/user.types";

const VALID_PLANS: VoicePlan[] = [
  "free",
  "gold",
  "diamond",
];

function isValidPlan(
  value: string
): value is VoicePlan {
  return (
    VALID_PLANS as string[]
  ).includes(value);
}

function isObjectIdLike(
  value: string
): boolean {
  return /^[a-f0-9]{24}$/i.test(
    value
  );
}

async function main() {
  const [
    identifier,
    planArg,
  ] = process.argv.slice(2);

  if (!identifier || !planArg) {
    console.error(
      "Usage: npx tsx scripts/set-user-plan.ts <phoneNumber|userId> <free|gold|diamond>"
    );

    process.exitCode = 1;
    return;
  }

  if (!isValidPlan(planArg)) {
    console.error(
      `Invalid plan "${planArg}" — must be one of: ${VALID_PLANS.join(", ")}`
    );

    process.exitCode = 1;
    return;
  }

  const mongo = new MongoDatabase({
    uri: config.database.mongoUri,
    logger,
  });

  await mongo.connect();

  try {
    const repository =
      new UserRepository();

    const service = new UserService(
      repository
    );

    const userId =
      isObjectIdLike(identifier)
        ? identifier
        : (
            await repository.findByPhoneNumber(
              identifier
            )
          )?.id;

    if (!userId) {
      console.error(
        `No user found for "${identifier}"`
      );

      process.exitCode = 1;
      return;
    }

    const updated =
      await service.setPlan(
        userId,
        planArg
      );

    if (!updated) {
      console.error(
        `No user found with id "${userId}"`
      );

      process.exitCode = 1;
      return;
    }

    console.log(
      `Set plan="${updated.plan}" for user ${updated._id} (${updated.phoneNumber ?? updated.email ?? "no identifier"})`
    );
  } finally {
    await mongo.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
