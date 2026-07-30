const EXPLICIT_NULL = Symbol('explicit-null-update');

/**
 * Wrap a record repository so selected null fields clear existing cells on Update,
 * while Create keeps the repository's existing omit-null behavior.
 *
 * The marker remains inside the in-memory sync plan only:
 * - Create payload: marker fields are omitted.
 * - Update payload: marker fields become explicit JSON null.
 */
export function createExplicitNullUpdateRepository(input = {}) {
  return new ExplicitNullUpdateRepository(input);
}

class ExplicitNullUpdateRepository {
  constructor(input = {}) {
    this.repository = requireObject(input.repository, 'repository');
    this.fieldNames = normalizeFieldNames(input.fieldNames);
  }

  async prepareRows(tableId, rows, context = {}) {
    const sourceRows = requireArray(rows, 'rows');
    const preparedRows = typeof this.repository.prepareRows === 'function'
      ? await this.repository.prepareRows(tableId, sourceRows, context)
      : sourceRows;
    if (!Array.isArray(preparedRows) || preparedRows.length !== sourceRows.length) {
      throw new Error('Explicit-null update repository requires one prepared row per source row');
    }

    return Object.freeze(preparedRows.map((prepared, index) => {
      const source = requireObject(sourceRows[index], 'source row');
      const output = { ...requireObject(prepared, 'prepared row') };
      for (const fieldName of this.fieldNames) {
        if (Object.hasOwn(source, fieldName) && source[fieldName] === null) {
          output[fieldName] = EXPLICIT_NULL;
        }
      }
      return Object.freeze(output);
    }));
  }

  async prepareExistingRecords(tableId, records, context = {}) {
    const sourceRecords = requireArray(records, 'records');
    const normalized = typeof this.repository.prepareExistingRecords === 'function'
      ? await this.repository.prepareExistingRecords(tableId, sourceRecords, context)
      : sourceRecords.map((record) => Object.freeze({
        recordId: requireText(record?.recordId ?? record?.record_id, 'recordId'),
        fields: Object.freeze({ ...requireObject(record?.fields ?? {}, 'record.fields') }),
      }));
    const incoming = new Set(requireArray(context.incomingFieldNames ?? [], 'incomingFieldNames'));
    return Object.freeze(requireArray(normalized, 'normalized records').map((record) => {
      const fields = { ...requireObject(record?.fields ?? {}, 'record.fields') };
      for (const fieldName of this.fieldNames) {
        if (incoming.has(fieldName) && !Object.hasOwn(fields, fieldName)) {
          fields[fieldName] = EXPLICIT_NULL;
        }
      }
      return Object.freeze({
        ...record,
        fields: Object.freeze(fields),
      });
    }));
  }

  async createMany(tableId, rows, options = {}) {
    const method = requireRepositoryMethod(this.repository, 'createMany');
    return method.call(
      this.repository,
      tableId,
      requireArray(rows, 'rows').map((row) => stripExplicitNullFields(row)),
      options,
    );
  }

  async updateMany(tableId, records, options = {}) {
    const method = requireRepositoryMethod(this.repository, 'updateMany');
    return method.call(
      this.repository,
      tableId,
      requireArray(records, 'records').map((record) => Object.freeze({
        ...record,
        fields: materializeExplicitNullFields(record?.fields),
      })),
      options,
    );
  }

  async listByFieldValues(...args) {
    return requireRepositoryMethod(this.repository, 'listByFieldValues').apply(this.repository, args);
  }

  async listAll(...args) {
    return requireRepositoryMethod(this.repository, 'listAll').apply(this.repository, args);
  }
}

function stripExplicitNullFields(row) {
  const output = {};
  for (const [fieldName, value] of Object.entries(requireObject(row, 'row'))) {
    if (value !== EXPLICIT_NULL) output[fieldName] = value;
  }
  return Object.freeze(output);
}

function materializeExplicitNullFields(fields) {
  const output = {};
  for (const [fieldName, value] of Object.entries(requireObject(fields, 'fields'))) {
    output[fieldName] = value === EXPLICIT_NULL ? null : value;
  }
  return Object.freeze(output);
}

function normalizeFieldNames(value) {
  const names = requireArray(value, 'fieldNames').map((fieldName) => requireText(fieldName, 'fieldName'));
  if (names.length === 0) throw new TypeError('Explicit-null update repository requires at least one fieldName');
  if (new Set(names).size !== names.length) throw new TypeError('Explicit-null update fieldNames must be unique');
  return Object.freeze([...names]);
}

function requireRepositoryMethod(repository, method) {
  if (typeof repository?.[method] !== 'function') {
    throw new TypeError(`Explicit-null update repository requires repository.${method}()`);
  }
  return repository[method];
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Explicit-null update repository requires array ${fieldName}`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Explicit-null update repository requires object ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Explicit-null update repository requires ${fieldName}`);
  }
  return value.trim();
}
