/**
 * User-Friendly Error Messages
 * 
 * This module provides production-ready error messages that:
 * 1. Hide technical details from end users
 * 2. Show full technical details to admins
 * 3. Are actionable and clear
 * 4. Never expose system architecture
 */

import type { ErrorCode } from '@ss/contracts';

interface FriendlyErrorConfig {
  userMessage: string;
  adminMessage?: string; // If different from userMessage
  action?: string; // What the user should do
}

/**
 * Mapping of error codes to user-friendly messages
 */
const ERROR_MESSAGES: Record<ErrorCode, FriendlyErrorConfig> = {
  // Authentication & Authorization
  UNAUTHENTICATED: {
    userMessage: 'Your session expired. Please sign in again.',
    action: 'Sign in',
  },
  
  NOT_COLLEGE_EMAIL: {
    userMessage: 'Please sign in with your VIT Bhopal email address (@vitbhopal.ac.in).',
    action: 'Use your college email',
  },
  
  FORBIDDEN: {
    userMessage: "You don't have permission to access this.",
    action: 'Contact support if you believe this is an error',
  },
  
  SESSION_REPLACED: {
    userMessage: 'You signed in from another device. Please sign in again here.',
    action: 'Sign in again',
  },
  
  // Device Management
  DEVICE_UNCLAIMED: {
    userMessage: 'Please finish signing in on this device.',
    action: 'Complete the sign-in process',
  },
  
  DEVICE_LIMIT: {
    userMessage: "You've reached the maximum number of devices (2). Remove a device from your profile to add this one.",
    action: 'Go to Profile → Manage Devices',
  },
  
  // Purchases & Access
  NOT_PURCHASED: {
    userMessage: 'You need to purchase this course to access its files.',
    action: 'Buy this course',
  },
  
  ALREADY_OWNED: {
    userMessage: 'You already own this course. Check your library.',
    action: 'Go to My Library',
  },
  
  // Reading
  LEASE_TAKEN: {
    userMessage: "You're reading this on another device or tab. Close it there first.",
    action: 'Close the file on your other device',
  },
  
  VIEWER_TOKEN_INVALID: {
    userMessage: 'Your reading session expired. Please reopen the file.',
    action: 'Reopen the file',
  },
  
  // Payments
  PAYMENT_INVALID: {
    userMessage: "We couldn't verify that payment. If you were charged, please contact support with your order details.",
    action: 'Contact support with your payment reference',
  },
  
  PAYMENTS_UNAVAILABLE: {
    userMessage: 'The payment system is temporarily unavailable. Nothing was charged. Please try again in a few minutes.',
    action: 'Try again in a few minutes',
  },
  
  // Content & System
  NOT_READY: {
    userMessage: 'This file is still being processed. Please check back in a few minutes.',
    adminMessage: 'File conversion in progress or failed. Check Admin → Conversions.',
    action: 'Try again in a few minutes',
  },
  
  NOT_FOUND: {
    userMessage: "We couldn't find that. It may have been removed or the link is incorrect.",
    action: 'Check the link or go back to the library',
  },
  
  BAD_REQUEST: {
    userMessage: "That wasn't quite right. Please check your input and try again.",
    action: 'Review your input',
  },
  
  // Rate Limiting
  RATE_LIMITED: {
    userMessage: "You're going a bit fast. Please wait a moment and try again.",
    action: 'Wait 1 minute, then try again',
  },
  
  // System Errors
  SYNC_FAILED: {
    userMessage: 'We encountered a sync issue. Our team has been notified. Please try again shortly.',
    adminMessage: 'R2 sync failed. Check Admin → Sync Health for details.',
    action: 'Try again in a few minutes',
  },
  
  INTERNAL: {
    userMessage: 'Something went wrong on our end. Our team has been notified. Please try again.',
    adminMessage: 'Server error. Check problem reports for stack trace.',
    action: 'Try again or contact support if it persists',
  },
};

/**
 * Get a user-friendly error message based on error code
 * 
 * @param code - The error code from the API
 * @param isAdmin - Whether the current user is an admin
 * @param originalMessage - The original error message (may contain technical details)
 * @returns A user-friendly error message
 */
export function getUserFriendlyMessage(
  code: ErrorCode,
  isAdmin: boolean,
  originalMessage?: string
): string {
  const config = ERROR_MESSAGES[code];
  
  if (!config) {
    // Unknown error code - show generic message
    return isAdmin && originalMessage
      ? `Error: ${originalMessage}`
      : 'An unexpected error occurred. Please try again.';
  }
  
  // For admins, prefer admin message if available
  if (isAdmin && config.adminMessage) {
    return config.adminMessage;
  }
  
  // Special cases where original message should be preserved
  if (code === 'RATE_LIMITED' && originalMessage && /network/i.test(originalMessage)) {
    return originalMessage; // Network-specific rate limit message
  }
  
  if (code === 'NOT_READY' && isAdmin && originalMessage) {
    return originalMessage; // Admins get specific file details
  }
  
  return config.userMessage;
}

/**
 * Get an action suggestion for the error
 */
export function getErrorAction(code: ErrorCode): string | undefined {
  return ERROR_MESSAGES[code]?.action;
}

/**
 * Check if this is a critical error that should be logged
 */
export function isCriticalError(code: ErrorCode): boolean {
  return ['INTERNAL', 'SYNC_FAILED', 'PAYMENTS_UNAVAILABLE'].includes(code);
}

/**
 * Check if this error is user-recoverable
 */
export function isUserRecoverable(code: ErrorCode): boolean {
  return ![
    'INTERNAL',
    'SYNC_FAILED',
    'PAYMENTS_UNAVAILABLE',
    'FORBIDDEN',
  ].includes(code);
}

/**
 * Get support message for this error
 */
export function getSupportMessage(code: ErrorCode): string {
  if (['PAYMENT_INVALID', 'INTERNAL', 'SYNC_FAILED'].includes(code)) {
    return 'If this problem persists, please contact support with the error details shown above.';
  }
  return '';
}
