import { DatabaseSync } from 'node:sqlite';

/** สร้าง D1-compatible test adapter บน SQLite in-memory สำหรับ Migration/Repository tests */
export function createSqliteD1(input = {}) {
  const database = new DatabaseSync(input.filename ?? ':memory:');
  database.exec('PRAGMA foreign_keys = ON;');

  return Object.freeze({
    database,
    exec(sql) { database.exec(String(sql)); },
    prepare(sql) {
      const statement = database.prepare(String(sql));
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async run() {
          const result = statement.run(...bindings);
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
        async first() {
          return statement.get(...bindings) ?? null;
        },
        async all() {
          return { results: statement.all(...bindings) };
        },
      };
    },
    close() { database.close(); },
  });
}
