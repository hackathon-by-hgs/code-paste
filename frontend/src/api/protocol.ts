/**
 * Version negotiation and policy.
 *
 * Unauthenticated, and the authoritative source for payload limits — they are
 * policy and may change without an API version bump, so nothing here is
 * hardcoded on the client.
 */

import { request } from '../lib/http';
import type { ProtocolPolicy } from './types';

export const getProtocolPolicy = (): Promise<ProtocolPolicy> =>
  request<ProtocolPolicy>('/protocol', { auth: false });
