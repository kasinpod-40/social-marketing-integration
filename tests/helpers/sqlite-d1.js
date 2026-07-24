import { DatabaseSync } from 'node:sqlite';

/** สร้าง D1-compatible test adapter บน SQLite in-memory สำหรับ Migration/Repository tests */
export function createSqliteD1(input = {}) {
  const rawDatabase = new DatabaseSync(input.filename ?? ':memory:');
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  const database = createPlainDatabase(rawDatabase);

  return Object.freeze({
    database,
    exec(sql) { rawDatabase.exec(String(sql)); },
    async batch(statements) {
      rawDatabase.exec('BEGIN;');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        rawDatabase.exec('COMMIT;');
        return results;
      } catch (error) {
        rawDatabase.exec('ROLLBACK;');
        throw error;
      }
    },
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

/** Wrapper แบบ explicit เพื่อไม่ดัก Symbol/internal properties ของ node:sqlite */
function createPlainDatabase(rawDatabase) {
  return Object.freeze({
    exec(sql) {
      return rawDatabase.exec(String(sql));
    },
    prepare(sql) {
      return createPlainStatement(rawDatabase.prepare(String(sql)));
    },
    close() {
      return rawDatabase.close();
    },
  });
}

function createPlainStatement(statement) {
  return Object.freeze({
    get(...values) {
      return toPlainRow(statement.get(...values));
    },
    all(...values) {
      return statement.all(...values).map(toPlainRow);
    },
    run(...values) {
      return statement.run(...values);
    },
  });
}

function toPlainRow(row) {
  return row ? { ...row } : null;
}
