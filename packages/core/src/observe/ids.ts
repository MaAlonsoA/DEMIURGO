// Interaction ids (spec §5.1): UUID version 7, ordered in time, whose 32 hex characters are the
// OpenTelemetry trace id. Only the milliseconds are taken from the clock; the rest is random, so
// two ids in the same millisecond are distinct but not ordered between themselves.

import { randomBytes } from 'node:crypto';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A UUID v7 (RFC 9562): 48-bit Unix milliseconds, version 7, variant 10, 74 random bits. */
export function uuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Math.max(0, Math.floor(now))) & 0xffffffffffffn;
  bytes.writeUIntBE(Number(ms), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Whether `value` has the shape of a UUID (any version), the only form a trace id can be built from. */
export function isUuid(value: string): boolean {
  return RE_UUID.test(value);
}

export function isUuidV7(value: string): boolean {
  return RE_UUID_V7.test(value);
}

/** The milliseconds a UUID v7 was generated at. */
export function uuidV7Time(value: string): number {
  return Number.parseInt(value.replace(/-/g, '').slice(0, 12), 16);
}
