import { mapClassificationDictionaryRecords } from '../services/classification-dictionary.js';

/**
 * Loads client-editable marketing classification rules from Lark Base.
 *
 * @param {Object} input
 * @param {{ listAll: Function }} input.repository
 * @param {string} input.tableId
 */
export async function loadClassificationDictionary(input) {
  const repository = requireRepository(input?.repository);
  const tableId = requireText(input?.tableId, 'tableId');
  const records = await repository.listAll(tableId);
  return mapClassificationDictionaryRecords(records);
}

function requireRepository(repository) {
  if (typeof repository?.listAll !== 'function') {
    throw new TypeError('loadClassificationDictionary requires repository.listAll');
  }

  return repository;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`loadClassificationDictionary requires ${fieldName}`);
  }

  return value.trim();
}
