import { readFile } from 'node:fs/promises';

/**
 * อ่านไฟล์ .dev.vars ของ Cloudflare เป็น Plain object
 * รองรับบรรทัดว่าง, Comment, คำว่า export, ค่า quoted และ Inline comment หลัง quote
 */
export async function readDevVars(filePath = '.dev.vars') {
  const text = await readFile(filePath, 'utf8');
  return parseDevVars(text);
}

/**
 * Parse เนื้อหา .dev.vars โดยให้ค่าบรรทัดหลังสุดชนะเมื่อ Key ซ้ำ
 * Parser นี้ไม่ Expand ตัวแปรและไม่ Execute shell เพื่อป้องกัน Code injection จากไฟล์ Config
 */
export function parseDevVars(text) {
  const env = {};
  const lines = String(text ?? '').split(/\r?\n/u);

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    env[parsed.key] = parsed.value;
  }

  return Object.freeze(env);
}

/** Parse หนึ่งบรรทัดและคืน null เมื่อเป็น Comment หรือรูปแบบไม่ถูกต้อง */
function parseLine(line) {
  const trimmed = String(line ?? '').trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const normalized = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed;
  const equalsIndex = normalized.indexOf('=');
  if (equalsIndex <= 0) return null;

  const key = normalized.slice(0, equalsIndex).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) return null;

  const rawValue = normalized.slice(equalsIndex + 1).trim();
  return Object.freeze({ key, value: parseValue(rawValue) });
}

/**
 * อ่านค่าหลังเครื่องหมาย = โดยรองรับ quote และ Inline comment
 * Backslash escape รองรับเฉพาะ quote/backslash เพื่อรักษาความหมายของ Secret โดยไม่แปลง \n เป็นบรรทัดใหม่
 */
function parseValue(value) {
  if (value === '') return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let output = '';
    let escaped = false;

    for (let index = 1; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        // ตัด Backslash เฉพาะเมื่อ Escape quote ชนิดเดียวกับที่เปิดค่า หรือ Escape Backslash
        // กรณีอื่น เช่น \n หรือ \t ต้องคง Backslash ไว้ตามตัวอักษรจริงของ Secret
        output += character === quote || character === '\\'
          ? character
          : `\\${character}`;
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) {
        const remainder = value.slice(index + 1).trim();
        if (remainder !== '' && !remainder.startsWith('#')) {
          throw new TypeError('Invalid .dev.vars value after closing quote');
        }
        return output;
      }
      output += character;
    }

    throw new TypeError('Unclosed quote in .dev.vars value');
  }

  return stripInlineComment(value);
}

/** ตัด Inline comment ที่มีช่องว่างนำหน้า เพื่อไม่ตัด # ซึ่งเป็นส่วนหนึ่งของ Secret */
function stripInlineComment(value) {
  const match = /\s+#/u.exec(value);
  return match ? value.slice(0, match.index).trim() : value.trim();
}
