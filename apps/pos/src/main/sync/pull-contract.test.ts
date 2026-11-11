import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { parsePullResponse } from './pull-protocol';
import { SyncProtocolError } from './sync-protocol';

const require = createRequire(import.meta.url);

interface PullCases {
  readonly responses: { name: string; response: unknown }[];
  readonly response_rejections: { name: string; response: unknown }[];
}

const CASES = JSON.parse(readFileSync(require.resolve('@pos-saas/contracts/cases/sync-pull.json'), 'utf-8')) as PullCases;

describe('the pull cases shared with the core', () => {
  it.each(CASES.responses.map((entry) => [entry.name, entry.response] as const))('the register accepts: %s', (_name, response) => {
    const page = parsePullResponse(response);

    expect(page.nextCursor).toBe((response as { nextCursor: string }).nextCursor);
  });

  it.each(CASES.response_rejections.map((entry) => [entry.name, entry.response] as const))('the register refuses: %s', (_name, response) => {
    expect(() => parsePullResponse(response)).toThrow(SyncProtocolError);
  });
});
