// Domain errors. Messages are in English, in product language.

export const HTTP_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_transition: 409,
  guard: 409,
  conflict: 409,
  validation: 422,
  not_implemented: 501,
} as const;

export type ErrorType = keyof typeof HTTP_STATUS;

export class DomainError extends Error {
  readonly type: ErrorType;
  readonly reasons: readonly string[];

  constructor(type: ErrorType, message: string, reasons: readonly string[] = []) {
    super(message);
    this.name = 'DomainError';
    this.type = type;
    this.reasons = reasons;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.type];
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
