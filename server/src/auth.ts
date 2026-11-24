import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { newId, now, users } from "./db.js";

export const COOKIE_NAME = "mpc_token";
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", 12);

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function createUser(email: string, password: string, role = "admin") {
  const id = newId();
  await users.insertOne({
    _id: id,
    email: email.trim().toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    role: role as "admin",
    createdAt: now(),
  });
  return id;
}

/** Create the first admin from env vars if the users table is empty. */
export async function seedAdmin() {
  if ((await users.countDocuments({}, { limit: 1 })) > 0) return;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn("[auth] No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.");
    return;
  }
  if (config.isProd && config.adminPassword === "change-me") {
    throw new Error("Refusing to create admin with the example password. Change ADMIN_PASSWORD.");
  }
  await createUser(config.adminEmail, config.adminPassword);
  console.log(`[auth] Created admin user ${config.adminEmail}`);
}

export async function verifyLogin(email: string, password: string): Promise<AuthUser | null> {
  const row = await users.findOne({ email: email.trim().toLowerCase() });
  // Always run bcrypt to keep timing similar whether or not the user exists.
  const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !ok) return null;
  return { id: row._id, email: row.email, role: row.role };
}

export async function changePassword(userId: string, current: string, next: string) {
  const row = await users.findOne({ _id: userId });
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) return false;
  await users.updateOne({ _id: userId }, { $set: { passwordHash: await bcrypt.hash(next, 12) } });
  return true;
}

export function signToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

function readToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[COOKIE_NAME] ?? null;
}

export async function authenticate(req: FastifyRequest): Promise<AuthUser | null> {
  const token = readToken(req);
  if (!token) return null;
  let sub: string | undefined;
  try {
    sub = (jwt.verify(token, config.jwtSecret) as jwt.JwtPayload).sub;
  } catch {
    return null;
  }
  if (!sub) return null;
  // Re-check the account so deleted users lose access immediately.
  const row = await users.findOne({ _id: sub }, { projection: { email: 1, role: 1 } });
  return row ? { id: row._id, email: row.email, role: row.role } : null;
}

/** Fastify preHandler: only admins pass. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = await authenticate(req);
  if (!user || user.role !== "admin") {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  req.user = user;
}
