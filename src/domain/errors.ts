export type DomainErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_QUANTITY'
  | 'AMOUNT_OUT_OF_RANGE';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
