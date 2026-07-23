import { DatabaseSync } from 'node:sqlite';

/** สร้าง D1-compatible test adapter บน SQLite in-memory สำหรับ Migration/Repository tests */
export function createSqliteD1(input = {}) {
  const rawDatabase = new DatabaseSync(input.filename ?? ':memory:');
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  const database = createPlainDatabase(rawDatabase);

  return Object.freeze({
    database,
    exec(sql) { rawDatabase.exec(String(sql)); },
    prepare(sql) {
      const statement = rawDatabase.prepare(String(sql));
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
          return toPlainRow(statement.get(...bindings));
        },
        async all() {
          return { results: statement.all(...bindings).map(toPlainRow) };
        },
      };
    },
    close() { rawDatabase.close(); },
  });
}

/** ทำให้การใช้ DatabaseSync โดยตรงใน Test คืน Row แบบเดียวกับ D1 adapter */
function createPlainDatabase(rawDatabase) {
  return new Proxy(rawDatabase, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => createPlainStatement(target.prepare(String(sql)));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createPlainStatement(statement) {
  return new Proxy(statement, {
    get(target, property) {
      if (property === 'get') return (...values) => toPlainRow(target.get(...values));
      if (property === 'all') return (...values) => target.all(...values).map(toPlainRow);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function toPlainRow(row) {
  return row ? { ...row } : null;
}
