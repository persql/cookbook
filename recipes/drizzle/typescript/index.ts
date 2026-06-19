import "dotenv/config";
import { drizzle } from "@persql/drizzle";
import { PerSQL } from "@persql/sdk";
import { asc, eq, gt, sql } from "drizzle-orm";
import { widgets } from "./schema.js";

const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;

// With a token: your real database on the edge. Without one: in-process
// SQLite via @persql/sdk's better-sqlite3 peer — same Drizzle code, no setup.
const client =
  token && database
    ? new PerSQL({ token })
    : new PerSQL({ local: ":memory:" });
const handle = client.database(database ?? "demo/widgets");

const db = drizzle(handle, { schema: { widgets } });

await db.run(sql`DROP TABLE IF EXISTS widgets`);
await db.run(sql`
  CREATE TABLE widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    in_stock INTEGER NOT NULL DEFAULT 1
  )
`);

await db.insert(widgets).values([
  { name: "sprocket", price: 4.5 },
  { name: "gadget", price: 19.0 },
  { name: "gizmo", price: 7.25, inStock: false },
]);

console.log("All widgets, cheapest first:");
const all = await db.select().from(widgets).orderBy(asc(widgets.price));
for (const w of all) {
  console.log(`  #${w.id} ${w.name} — $${w.price} ${w.inStock ? "" : "(out of stock)"}`);
}

await db.update(widgets).set({ price: 5.0 }).where(eq(widgets.name, "sprocket"));

console.log("\nIn stock and over $5:");
const pricey = await db
  .select({ name: widgets.name, price: widgets.price })
  .from(widgets)
  .where(gt(widgets.price, 5))
  .orderBy(asc(widgets.name));
console.log(pricey);

await db.delete(widgets).where(eq(widgets.inStock, false));
const remaining = await db.select({ n: sql<number>`count(*)` }).from(widgets);
console.log(`\n${remaining[0].n} widgets left after clearing out-of-stock.`);
