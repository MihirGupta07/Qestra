import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "../domain";

const roleRank: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3
};

export function readRole(request: FastifyRequest): UserRole {
  const role = request.headers["x-user-role"];
  if (role === "viewer" || role === "operator" || role === "admin" || role === "owner") {
    return role;
  }

  return "owner";
}

export function requireRole(minimumRole: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = readRole(request);

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
