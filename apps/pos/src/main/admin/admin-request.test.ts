import { describe, expect, it } from 'vitest';

import { MAX_PASSPHRASE_LENGTH, parsePassphraseRequest } from './admin-request';

describe('parsePassphraseRequest', () => {
  it('returns the passphrase', () => {
    expect(parsePassphraseRequest({ passphrase: 'una contraseña larga', extra: 1 })).toBe('una contraseña larga');
  });

  it.each([[undefined], [null], ['x'], [{}], [{ passphrase: 5 }], [{ passphrase: 'x'.repeat(MAX_PASSPHRASE_LENGTH + 1) }]])('refuses %j', (value) => {
    expect(() => parsePassphraseRequest(value)).toThrow(TypeError);
  });
});