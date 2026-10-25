import { ErrorCode } from '@ss/contracts';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  NOT_COLLEGE_EMAIL: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SESSION_REPLACED: 401,
  DEVICE_UNCLAIMED: 409,
  DEVICE_LIMIT: 409,
  NOT_PURCHASED: 403,
  ALREADY_OWNED: 409,
  LEASE_TAKEN: 409,
  VIEWER_TOKEN_INVALID: 401,
  RATE_LIMITED: 429,
  PAYMENT_INVALID: 400,
  NOT_READY: 409,
  SYNC_FAILED: 502,
  PAYMENTS_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** The one error type use cases throw. The HTTP layer turns it into `{ error: {...} }`. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const fail = {
  badRequest: (m = 'That request was not valid.') => new AppError(ErrorCode.BadRequest, m),
  unauthenticated: () => new AppError(ErrorCode.Unauthenticated, 'Please sign in.'),
  notCollege: () =>
    new AppError(ErrorCode.NotCollegeEmail, 'Please sign in with your @vitbhopal.ac.in email.'),
  forbidden: () => new AppError(ErrorCode.Forbidden, 'You do not have access to this.'),
  notFound: (what = 'That') => new AppError(ErrorCode.NotFound, `${what} could not be found.`),
  sessionReplaced: (reason: 'newer-sign-in' | 'device-check') =>
    new AppError(ErrorCode.SessionReplaced, 'This sign-in is no longer the active session.', { reason }),
  deviceUnclaimed: () => new AppError(ErrorCode.DeviceUnclaimed, 'Finish signing in on this device.'),
  deviceLimit: (devices: unknown) =>
    new AppError(ErrorCode.DeviceLimit, 'This account already has the maximum number of devices.', devices),
  notPurchased: () => new AppError(ErrorCode.NotPurchased, 'Buy this course to open its files.'),
  alreadyOwned: () => new AppError(ErrorCode.AlreadyOwned, 'This course is already on your shelf.'),
  leaseTaken: () => new AppError(ErrorCode.LeaseTaken, 'You are reading on another device or tab.'),
  viewerToken: () =>
    new AppError(ErrorCode.ViewerTokenInvalid, 'Your reading session expired. Reopen the file.'),
  rateLimited: () => new AppError(ErrorCode.RateLimited, 'Slow down a little and try again shortly.'),
  paymentInvalid: () => new AppError(ErrorCode.PaymentInvalid, 'We could not verify that payment.'),
  notReady: (message = 'This file is still being prepared.') => new AppError(ErrorCode.NotReady, message),
  syncFailed: (message: string) => new AppError(ErrorCode.SyncFailed, message),
  paymentsUnavailable: () =>
    new AppError(
      ErrorCode.PaymentsUnavailable,
      "Payments can't start right now. Nothing was charged. Please try again in a few minutes.",
    ),
};
