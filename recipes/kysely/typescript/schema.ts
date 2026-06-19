import type { Generated } from "kysely";

export interface WidgetTable {
  id: Generated<number>;
  name: string;
  price: number;
  // SQLite has no boolean type; store 0/1.
  in_stock: number;
}

export interface DB {
  widgets: WidgetTable;
}
