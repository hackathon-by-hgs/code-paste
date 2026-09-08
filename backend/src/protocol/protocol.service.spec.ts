import { readContractsVersion } from './protocol.service';

describe('readContractsVersion', () => {
  const original = process.env.CONTRACTS_VERSION;

  afterEach(() => {
    if (original === undefined) delete process.env.CONTRACTS_VERSION;
    else process.env.CONTRACTS_VERSION = original;
  });

  it('prefers the environment variable', () => {
    // A container has no CONTRACTS_VERSION file: the pin lives at the branch root, outside the
    // Docker build context. Without this the image reported "unknown" and drift between a
    // deployment and its contract became undetectable.
    process.env.CONTRACTS_VERSION = 'protocol-v9.9.9';
    expect(readContractsVersion()).toBe('protocol-v9.9.9');
  });

  it('trims surrounding whitespace', () => {
    process.env.CONTRACTS_VERSION = '  protocol-v1.0.0\n';
    expect(readContractsVersion()).toBe('protocol-v1.0.0');
  });

  it('falls back to the file when the variable is empty', () => {
    // An empty env var is "not configured", exactly as it is everywhere else in the config.
    process.env.CONTRACTS_VERSION = '   ';
    expect(readContractsVersion()).toBe('protocol-v1.0.0');
  });

  it('reads the pinned tag from disk when unset', () => {
    delete process.env.CONTRACTS_VERSION;
    expect(readContractsVersion()).toBe('protocol-v1.0.0');
  });
});
