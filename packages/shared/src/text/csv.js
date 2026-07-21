/** Parse RFC4180-style CSV text into immutable record objects. */
export function parseCsvRecords(text) {
  if (typeof text !== 'string') throw new TypeError('CSV text must be a string');
  const rows = parseCsvRows(text);
  if (rows.length === 0) return Object.freeze([]);
  const headers = rows[0].map((value) => value.trim());
  if (headers.some((header) => header === '')) throw new TypeError('CSV headers must not be empty');
  if (new Set(headers).size !== headers.length) throw new TypeError('CSV headers must be unique');

  return Object.freeze(rows.slice(1)
    .filter((row) => row.some((value) => value !== ''))
    .map((row, rowIndex) => {
      if (row.length > headers.length) {
        throw new TypeError(`CSV row ${rowIndex + 2} contains more columns than the header`);
      }
      const record = {};
      for (let index = 0; index < headers.length; index += 1) {
        record[headers[index]] = row[index] ?? '';
      }
      return Object.freeze(record);
    }));
}

/** Parse CSV while preserving commas, quotes and line breaks inside quoted cells. */
export function parseCsvRows(text) {
  if (typeof text !== 'string') throw new TypeError('CSV text must be a string');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell !== '') throw new TypeError('CSV quote must start at the beginning of a cell');
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (quoted) throw new TypeError('CSV contains an unterminated quoted cell');
  if (cell !== '' || row.length > 0) {
    row.push(cell.replace(/\r$/u, ''));
    rows.push(row);
  }
  return Object.freeze(rows.map((values) => Object.freeze(values)));
}
