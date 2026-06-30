import "../env.js";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

export const prisma = databaseUrl ? new PrismaClient() : null;

export function hasDatabase() {
  return prisma !== null;
}
