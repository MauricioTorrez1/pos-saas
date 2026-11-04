import { describe, expect, it } from 'vitest';

import { assertTrustedSender, isTrustedUrl } from './trusted-url';

const DEV_ENTRY = 'http://localhost:5173/';
const BUILT_ENTRY = 'file:///C:/register/out/renderer/index.html';

describe('isTrustedUrl', () => {
  it.each([
    { name: 'the dev server itself', url: 'http://localhost:5173/', entry: DEV_ENTRY },
    { name: 'another path on the dev server', url: 'http://localhost:5173/src/App.tsx', entry: DEV_ENTRY },
    { name: 'the built page', url: BUILT_ENTRY, entry: BUILT_ENTRY },
    { name: 'the built page with an inner route', url: `${BUILT_ENTRY}#/sales`, entry: BUILT_ENTRY },
  ])('trusts $name', ({ url, entry }) => {
    expect(isTrustedUrl(url, entry)).toBe(true);
  });

  it.each([
    { name: 'another site', url: 'https://example.com/', entry: DEV_ENTRY },
    { name: 'another port', url: 'http://localhost:5174/', entry: DEV_ENTRY },
    { name: 'a lookalike host', url: 'http://localhost.example.com:5173/', entry: DEV_ENTRY },
    { name: 'the same host over another scheme', url: 'https://localhost:5173/', entry: DEV_ENTRY },
    { name: 'a website while running the built page', url: 'https://example.com/', entry: BUILT_ENTRY },
    { name: 'another local file', url: 'file:///C:/Windows/System32/calc.html', entry: BUILT_ENTRY },
    { name: 'a file on a network share', url: 'file://attacker/register/out/renderer/index.html', entry: BUILT_ENTRY },
    { name: 'a local file while on the dev server', url: BUILT_ENTRY, entry: DEV_ENTRY },
    { name: 'a malformed address', url: 'not a url', entry: DEV_ENTRY },
    { name: 'an empty address', url: '', entry: BUILT_ENTRY },
  ])('rejects $name', ({ url, entry }) => {
    expect(isTrustedUrl(url, entry)).toBe(false);
  });
});

describe('assertTrustedSender', () => {
  it('accepts a call from the register screen', () => {
    expect(() => assertTrustedSender(BUILT_ENTRY, BUILT_ENTRY)).not.toThrow();
  });

  it('rejects a call from another page', () => {
    expect(() => assertTrustedSender('https://example.com/', BUILT_ENTRY)).toThrow('untrusted');
  });

  it('rejects a call whose frame is already gone', () => {
    expect(() => assertTrustedSender(undefined, BUILT_ENTRY)).toThrow('untrusted');
  });
});
