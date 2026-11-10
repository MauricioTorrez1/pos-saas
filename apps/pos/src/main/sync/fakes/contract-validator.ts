import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';

const require = createRequire(import.meta.url);

function readSchema(name: string): object {
  return JSON.parse(readFileSync(require.resolve(`@pos-saas/contracts/schemas/${name}`), 'utf-8')) as object;
}

const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(readSchema('values.schema.json'), 'values.schema.json');
const checkRequest = ajv.compile(readSchema('sync-push-request.schema.json'));

/**
 * Checks a batch against the push contract of `packages/contracts`, the same file the Java core will be built from. It is
 * for tests only: it proves that what the register really writes is what the contract says.
 *
 * @param request the batch to check
 * @returns what is wrong with it, or an empty list if it follows the contract
 */
export function contractErrorsOfPushRequest(request: unknown): string[] {
  return checkRequest(request) ? [] : (checkRequest.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? error.keyword}`);
}
