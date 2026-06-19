import "dotenv/config";
import { PerSQL } from "@persql/sdk";
import { PrismaPerSQL } from "@persql/prisma";
import { PrismaClient } from "./generated/prisma/client.js";
import { SCHEMA_SQL } from "./schema.js";

const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;

// With a token: your real database on the edge. Without one: in-process
// SQLite via @persql/sdk's better-sqlite3 peer — same Prisma code, no setup.
const client =
  token && database
    ? new PerSQL({ token })
    : new PerSQL({ local: ":memory:" });
const handle = client.database(database ?? "demo/widgets");

await handle.query(`DROP TABLE IF EXISTS "Widget"`);
await handle.query(SCHEMA_SQL);

const adapter = new PrismaPerSQL({ database: handle });
const prisma = new PrismaClient({ adapter });

await prisma.widget.createMany({
  data: [
    { name: "sprocket", price: 4.5 },
    { name: "gadget", price: 19.0 },
    { name: "gizmo", price: 7.25, inStock: false },
  ],
});

console.log("All widgets, cheapest first:");
const all = await prisma.widget.findMany({ orderBy: { price: "asc" } });
for (const w of all) {
  console.log(`  #${w.id} ${w.name} — $${w.price} ${w.inStock ? "" : "(out of stock)"}`);
}

await prisma.widget.update({ where: { id: all[0].id }, data: { price: 5.0 } });

console.log("\nIn stock and over $5:");
const pricey = await prisma.widget.findMany({
  where: { inStock: true, price: { gt: 5 } },
  select: { name: true, price: true },
  orderBy: { name: "asc" },
});
console.log(pricey);

const removed = await prisma.widget.deleteMany({ where: { inStock: false } });
const remaining = await prisma.widget.count();
console.log(`\nRemoved ${removed.count} out-of-stock; ${remaining} widgets left.`);

await prisma.$disconnect();
