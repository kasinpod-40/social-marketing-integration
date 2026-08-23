export function readWranglerScalarVars(sourceText) {
  const source = requireText(sourceText, 'sourceText');
  let parsed;
  try {
    parsed = JSON.parse(removeTrailingCommas(stripJsoncComments(source)));
  } catch (cause) {
    const error = new Error('Wrangler config JSONC could not be parsed safely');
    error.name = 'WranglerJsoncVarsError';
    error.code = 'WRANGLER_JSONC_VARS_PARSE_FAILED';
    error.cause = cause;
    throw error;
  }
  const vars = parsed?.vars;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return Object.freeze({});
  const output = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = String(value);
    }
  }
  return Object.freeze(output);
}

function stripJsoncComments(source) {
  let output = '';
  let inString = false;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false;
        output += char;
      } else {
        output += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        output += '  ';
        index += 1;
        blockComment = false;
      } else {
        output += char === '\n' || char === '\r' ? char : ' ';
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = null;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    output += char;
  }
  if (inString || blockComment) {
    const error = new Error('Wrangler config JSONC contains an unterminated token');
    error.name = 'WranglerJsoncVarsError';
    error.code = 'WRANGLER_JSONC_VARS_PARSE_FAILED';
    throw error;
  }
  return output;
}

function removeTrailingCommas(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      let cursor = index + 1;
      while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
      if (source[cursor] === '}' || source[cursor] === ']') continue;
    }
    output += char;
  }
  return output;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value;
}
