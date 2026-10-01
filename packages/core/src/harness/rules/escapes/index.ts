// Registry of the escape rules (salud-del-harness §4.2). One pure function per rule; adding one is an import and an
// entry. A change to any rule or attribution must bump `ESCAPES_RULES_VERSION` (types.ts): old escapes are kept.
// Pending for lack of stored data: E14 (reviewer hints about another feature's piece: Jev's triage hints are not stored)
// (E15 and E16 exist since esc-2).

import { e01 } from "./e01.ts";
import { e02 } from "./e02.ts";
import { e03 } from "./e03.ts";
import { e04 } from "./e04.ts";
import { e05 } from "./e05.ts";
import { e06 } from "./e06.ts";
import { e07 } from "./e07.ts";
import { e08 } from "./e08.ts";
import { e09 } from "./e09.ts";
import { e10 } from "./e10.ts";
import { e11 } from "./e11.ts";
import { e12 } from "./e12.ts";
import { e13 } from "./e13.ts";
import { e15 } from "./e15.ts";
import { e16 } from "./e16.ts";
import type { EscapeRule } from "./types.ts";

export { E11_COMMANDS } from "./e11.ts";
export * from "./types.ts";

export const ESCAPE_RULES: Record<string, EscapeRule> = {
  E01: e01,
  E02: e02,
  E03: e03,
  E04: e04,
  E05: e05,
  E06: e06,
  E07: e07,
  E08: e08,
  E09: e09,
  E10: e10,
  E11: e11,
  E12: e12,
  E13: e13,
  E15: e15,
  E16: e16,
};
export const PENDING_ESCAPE_RULES = ["E14"] as const;
