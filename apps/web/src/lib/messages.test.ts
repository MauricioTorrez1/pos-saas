import { describe, expect, it } from 'vitest';
import { shortTenantId } from './format';
import { noticeFor } from './messages';

describe('noticeFor', () => {
  it('translates a known code', () => {
    expect(noticeFor('session_expired')?.text).toMatch(/sesión terminó/);
  });

  it('gives nothing for an unknown or missing code, so a URL cannot write on the screen', () => {
    expect(noticeFor('<script>alert(1)</script>')).toBeNull();
    expect(noticeFor(undefined)).toBeNull();
  });
});

describe('shortTenantId', () => {
  it('keeps the start and the end of a UUID', () => {
    expect(shortTenantId('0192f3a4-7b1c-7e2d-8a3f-5c9d1e2b4a60')).toBe('0192f3a4…4a60');
  });

  it('leaves a short value alone', () => {
    expect(shortTenantId('abc')).toBe('abc');
  });
});
