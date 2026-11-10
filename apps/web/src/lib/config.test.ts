import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const valid = {
  PANEL_OIDC_ISSUER_URL: 'http://localhost:8180/realms/pos',
  PANEL_BASE_URL: 'http://localhost:3000',
  PANEL_CORE_API_URL: 'http://localhost:8080',
  PANEL_SESSION_SECRET: 'x'.repeat(32),
} as unknown as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('reads the settings and defaults the client id to pos-panel', () => {
    const config = loadConfig(valid);

    expect(config.clientId).toBe('pos-panel');
    expect(config.issuerUrl.href).toBe('http://localhost:8180/realms/pos');
    expect(config.baseUrl.origin).toBe('http://localhost:3000');
  });

  it('rejects a missing URL by name, without printing values', () => {
    const env = { ...valid, PANEL_CORE_API_URL: undefined } as unknown as NodeJS.ProcessEnv;

    expect(() => loadConfig(env)).toThrow('PANEL_CORE_API_URL is not set');
  });

  it('rejects a malformed URL', () => {
    const env = { ...valid, PANEL_BASE_URL: 'localhost' } as unknown as NodeJS.ProcessEnv;

    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('rejects a short session secret and does not echo it', () => {
    const env = { ...valid, PANEL_SESSION_SECRET: 'short-secret' } as unknown as NodeJS.ProcessEnv;

    expect(() => loadConfig(env)).toThrow(/at least 32/);
    expect(() => loadConfig(env)).not.toThrow(/short-secret/);
  });
});
