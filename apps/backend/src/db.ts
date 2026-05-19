/**
 * MikroORM lifecycle for the backend. The ORM is initialised once at boot;
 * each tRPC request forks the EntityManager so it gets its own identity map
 * and unit of work (the recommended v7 pattern).
 */
import { MikroORM } from "@mikro-orm/sqlite";
import config from "./mikro-orm.config.ts";

let ormPromise: Promise<MikroORM> | null = null;

export async function getOrm(): Promise<MikroORM> {
  if (!ormPromise) {
    ormPromise = (async () => {
      const orm = await MikroORM.init(config);
      // Ensure the schema exists. SQLite + a single-process dev server means
      // we can lean on a one-shot update rather than running migrations.
      await orm.schema.update();
      return orm;
    })();
  }
  return ormPromise;
}
