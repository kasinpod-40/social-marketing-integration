/** Canonicalize rows exactly as fetch JSON transport will deliver them to the Preview Worker. */
export function canonicalizeMetaK2ProjectionRows(rowsInput) {
  if (!Array.isArray(rowsInput)) throw new TypeError('Meta K2 projection rows must be an array');
  let serialized;
  try {
    serialized = JSON.stringify(rowsInput);
  } catch {
    throw new TypeError('Meta K2 projection rows must be JSON serializable');
  }
  const rows = JSON.parse(serialized);
  if (!Array.isArray(rows)) throw new TypeError('Meta K2 projection rows must remain an array');
  return rows;
}
