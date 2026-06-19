// The table behind the `Widget` model in prisma/schema.prisma.
//
// Prisma normally generates this DDL for you (`prisma migrate diff` or
// `prisma migrate dev`). PerSQL's HTTP API has no held connection, so the
// Prisma CLI can't push migrations through the adapter — apply schema changes
// with PerSQL's migration tools (or this one statement) instead, then let
// PrismaClient handle every read and write. See the recipe README.
export const SCHEMA_SQL = `
  CREATE TABLE "Widget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "inStock" BOOLEAN NOT NULL DEFAULT true
  )
`;
