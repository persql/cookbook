import "dotenv/config";
import { Kysely } from "kysely";
import { PerSQLDialect } from "@persql/kysely";
import { PerSQL } from "@persql/sdk";
import type { DB } from "./schema.js";

const token = process.env.PERSQL_TOKEN;
const database = process.env.PERSQL_DATABASE;

// With a token: your real database on the edge. Without one: in-process
// SQLite via @persql/sdk's better-sqlite3 peer — same Kysely code, no setup.
const client =
  token && database
    ? new PerSQL({ token })
    : new PerSQL({ local: ":memory:" });
const handle = client.database(database ?? "demo/widgets");

const db = new Kysely<DB>({ dialect: new PerSQLDialect({ database: handle }) });

await db.schema.dropTable("widgets").ifExists().execute();
await db.schema
  .createTable("widgets")
  .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
  .addColumn("name", "text", (c) => c.notNull())
  .addColumn("price", "real", (c) => c.notNull())
  .addColumn("in_stock", "integer", (c) => c.notNull().defaultTo(1))
  .execute();

await db
  .insertInto("widgets")
  .values([
    { name: "sprocket", price: 4.5, in_stock: 1 },
    { name: "gadget", price: 19.0, in_stock: 1 },
    { name: "gizmo", price: 7.25, in_stock: 0 },
  ])
  .execute();

console.log("All widgets, cheapest first:");
const all = await db.selectFrom("widgets").selectAll().orderBy("price", "asc").execute();
for (const w of all) {
  console.log(`  #${w.id} ${w.name} — $${w.price} ${w.in_stock ? "" : "(out of stock)"}`);
}

// Statements between BEGIN and COMMIT ship as one transactional batch.
await db.transaction().execute(async (trx) => {
  await trx.insertInto("widgets").values({ name: "cog", price: 2.0, in_stock: 1 }).execute();
  await trx.updateTable("widgets").set({ price: 5.0 }).where("name", "=", "sprocket").execute();
});

console.log("\nIn stock and over $4:");
const pricey = await db
  .selectFrom("widgets")
  .select(["name", "price"])
  .where("in_stock", "=", 1)
  .where("price", ">", 4)
  .orderBy("name", "asc")
  .execute();
console.log(pricey);

await db.deleteFrom("widgets").where("in_stock", "=", 0).execute();
const [{ n }] = await db
  .selectFrom("widgets")
  .select((eb) => eb.fn.countAll<number>().as("n"))
  .execute();
console.log(`\n${n} widgets left after clearing out-of-stock.`);

await db.destroy();
