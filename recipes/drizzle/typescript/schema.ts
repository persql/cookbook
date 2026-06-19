import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const widgets = sqliteTable("widgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  price: real("price").notNull(),
  inStock: integer("in_stock", { mode: "boolean" }).notNull().default(true),
});

export type Widget = typeof widgets.$inferSelect;
