/**
 * Every error the API can return. The web app maps each code to a friendly message,
 * so adding a code here is the only place a new failure mode needs to be declared.
 */
export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  Unauthenticated: 'UNAUTHENTICATED',
  NotCollegeEmail: 'NOT_COLLEGE_EMAIL',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  SessionReplaced: 'SESSION_REPLACED',
  DeviceUnclaimed: 'DEVICE_UNCLAIMED',
  DeviceLimit: 'DEVICE_LIMIT',
  NotPurchased: 'NOT_PURCHASED',
  AlreadyOwned: 'ALREADY_OWNED',
  LeaseTaken: 'LEASE_TAKEN',
  ViewerTokenInvalid: 'VIEWER_TOKEN_INVALID',
  RateLimited: 'RATE_LIMITED',
  PaymentInvalid: 'PAYMENT_INVALID',
  NotReady: 'NOT_READY',
  SyncFailed: 'SYNC_FAILED',
  Internal: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}
