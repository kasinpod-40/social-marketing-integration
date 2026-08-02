#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildLarkNativeAiSchemaPreview } from '../packages/config/src/lark-native-ai-schema-preview.js';

let stage = 'parse-arguments';
try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inventoryPath) {
    printJson({
      ok: true,
      planOnly: true,
      contractVersion: 'lark_native_ai_schema_preview_v1',
      command: 'node scripts/lark-native-ai-schema-preview.mjs --inventory <base-inventory.json> [--output <preview.json>]',
      acceptedInput: 'offline normalized Base inventory JSON',
      applyAuthorized: false,
      remoteLarkRead: 0,
      remoteLarkWrite: 0,
      automationCreate: 0,
      notificationSend: 0,
      production: 'BLOCKED',
    });
  } else {
    stage = 'read-inventory';
    const inventory = JSON.parse(await readFile(options.inventoryPath, 'utf8'));
    stage = 'build-preview';
    const preview = buildLarkNativeAiSchemaPreview({ inventory });
    if (options.outputPath) {
      stage = 'write-local-preview';
      await writeFile(options.outputPath, `${JSON.stringify(preview, null, 2)}\n`, { mode: 0o600 });
    }
    printJson({
      ...preview,
      outputPath: options.outputPath,
    });
    if (!preview.ok) process.exitCode = 2;
  }
} catch (error) {
  printJson({
    ok: false,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_SCHEMA_PREVIEW_FAILED',
    message: error instanceof Error ? error.message : String(error),
    applyAuthorized: false,
    remoteLarkRead: 0,
    remoteLarkWrite: 0,
    automationCreate: 0,
    notificationSend: 0,
    production: 'BLOCKED',
  }, process.stderr);
  process.exitCode = 1;
}

function parseArgs(args) {
  let inventoryPath = null;
  let outputPath = null;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--inventory') inventoryPath = requirePath(args[++index], '--inventory');
    else if (token === '--output') outputPath = requirePath(args[++index], '--output');
    else if (token === '--apply' || token === '--execute') {
      throw codedError('Live Apply is not supported by the schema Preview operator', 'LARK_NATIVE_AI_SCHEMA_APPLY_NOT_AUTHORIZED');
    } else {
      throw codedError(`Unsupported argument: ${token}`, 'LARK_NATIVE_AI_SCHEMA_PREVIEW_ARGUMENT_UNSUPPORTED');
    }
  }
  return Object.freeze({
    inventoryPath: inventoryPath ? resolve(inventoryPath) : null,
    outputPath: outputPath ? resolve(outputPath) : null,
  });
}

function requirePath(value, flag) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw codedError(`${flag} requires a path`, 'LARK_NATIVE_AI_SCHEMA_PREVIEW_PATH_REQUIRED');
  }
  return value.trim();
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}
