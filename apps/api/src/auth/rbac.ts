import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "../config";
import type { UserRole } from "../domain";

const roleRank: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3
};

export function readRole(request: FastifyRequest, config: ApiConfig): UserRole {
  const role = request.headers["x-user-role"];
  if (role === "viewer" || role === "operator" || role === "admin" || role === "owner") {
    return role;
  }

  return config.nodeEnv === "production" ? "viewer" : "owner";
}

export function requireRole(minimumRole: UserRole, config: ApiConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.apiAuthToken) {
      const auth = request.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : request.headers["x-api-token"];

      if (token !== config.apiAuthToken) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    }

    const role = readRole(request, config);

    if (roleRank[role] < roleRank[minimumRole]) {
      return reply.code(403).send({
        error: "Forbidden",
        requiredRole: minimumRole,
        actualRole: role
      });
    }

    return undefined;
  };
}
