import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { AppContainer } from "../../app/container";
import { AppError } from "../../shared/errors/app-error";

interface TimezoneQuery {
  latitude?: string;
  longitude?: string;
}

function parseCoordinate(
  raw: string | undefined,
  fieldName: string
): number {
  if (raw === undefined || raw === "") {
    throw new AppError(
      `${fieldName} is required`,
      400
    );
  }

  const value = Number(raw);

  if (Number.isNaN(value)) {
    throw new AppError(
      `${fieldName} must be a number`,
      400
    );
  }

  return value;
}

/**
 * Authenticated but not scoped to a user/resource — same
 * reasoning as the rest of `modules/places`.
 */
export async function registerPlacesController(
  app: FastifyInstance,
  container: AppContainer
): Promise<void> {
  const service = container.services.places;

  app.get<{
    Querystring: TimezoneQuery;
  }>(
    "/places/timezone",
    {
      preHandler: [app.authenticate],
    },
    async (
      request: FastifyRequest<{
        Querystring: TimezoneQuery;
      }>,
      reply: FastifyReply
    ) => {
      const latitude = parseCoordinate(
        request.query.latitude,
        "latitude"
      );

      const longitude = parseCoordinate(
        request.query.longitude,
        "longitude"
      );

      const resolved =
        await service.resolveTimezone(
          latitude,
          longitude
        );

      return reply.send({
        success: true,
        data: resolved,
      });
    }
  );
}
