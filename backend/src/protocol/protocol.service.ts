import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { unsupportedProtocolVersion } from '../common/errors';
import type { ContentType } from '../devices/device.entity';

/**
 * Protocol negotiation and payload policy (ADR-008).
 *
 * Three version axes are kept separate on purpose: the API version (URL path), the clipboard
 * protocol version (in payloads, negotiated here) and the pinned contract tag. Collapsing them
 * would force every client to move whenever any one of them changed.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [1] as const;
export const CURRENT_PROTOCOL_VERSION = 1;

/**
 * Authoritative payload limits, closing `SPEC_CONTRACT.md` gap #7.
 *
 * `PROTOCOL.md` gives these as starting defaults that must be configurable "at the protocol
 * boundary" but names no owner. The control plane is that owner: it distributes them in every
 * peer roster, so two agents can never enforce different ceilings.
 *
 * The backend never handles a clipboard payload itself — these are policy it publishes, not a
 * limit it applies to its own request bodies (that is HTTP_MAX_BODY_BYTES, and it is far smaller).
 */
export const PAYLOAD_LIMITS: Record<ContentType, number> = {
  'text/plain': 1024 * 1024, // 1 MiB
  'image/png': 10 * 1024 * 1024, // 10 MiB
  'image/jpeg': 10 * 1024 * 1024, // 10 MiB
};

export interface ProtocolPolicy {
  apiVersion: string;
  supportedProtocolVersions: number[];
  currentProtocolVersion: number;
  contractsVersion: string;
  limits: Record<ContentType, number>;
}

@Injectable()
export class ProtocolService {
  private readonly contractsVersion = readContractsVersion();

  getPolicy(): ProtocolPolicy {
    return {
      apiVersion: 'v1',
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      currentProtocolVersion: CURRENT_PROTOCOL_VERSION,
      contractsVersion: this.contractsVersion,
      limits: { ...PAYLOAD_LIMITS },
    };
  }

  isSupported(version: number): boolean {
    return (SUPPORTED_PROTOCOL_VERSIONS as readonly number[]).includes(version);
  }

  /**
   * Rejects an unsupported version loudly.
   *
   * Never a silent downgrade or a best-effort reinterpretation: a client that believes it is
   * speaking v2 while the server treats it as v1 is the worst available outcome, because both
   * sides think they succeeded.
   */
  assertSupported(version: number): void {
    if (!this.isSupported(version)) throw unsupportedProtocolVersion(SUPPORTED_PROTOCOL_VERSIONS);
  }

  getLimits(): Record<ContentType, number> {
    return { ...PAYLOAD_LIMITS };
  }
}

/**
 * Reads the pinned contract tag so a running instance can report which contract it was built
 * against. Makes contract drift observable at runtime instead of theoretical.
 *
 * The environment variable comes first because `CONTRACTS_VERSION` lives at the branch root, one
 * level above the Docker build context — so a container has no file to read and every deployed
 * instance reported "unknown", quietly defeating the point of publishing the field at all. The
 * image bakes it in at build time from the same file.
 */
export function readContractsVersion(): string {
  const fromEnv = process.env.CONTRACTS_VERSION?.trim();
  if (fromEnv) return fromEnv;

  for (const candidate of [
    join(__dirname, '../../../CONTRACTS_VERSION'),
    join(__dirname, '../../CONTRACTS_VERSION'),
    join(process.cwd(), '..', 'CONTRACTS_VERSION'),
    join(process.cwd(), 'CONTRACTS_VERSION'),
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8').trim();
  }
  return 'unknown';
}
