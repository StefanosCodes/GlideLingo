export const AUTH_CODE_RESEND_SECONDS = 30;

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  captcha_client_attempts_exceeded: 'Too many security-check attempts. Refresh the page and try again.',
  captcha_invalid: 'We could not confirm this request. Please try again.',
  captcha_missing: 'Please complete the security check and try again.',
  captcha_missing_token: 'Complete the security check, then try again.',
  captcha_not_enabled: 'Account creation is temporarily unavailable. Please try again later.',
  captcha_script_failed_to_load: 'The security check could not load. Refresh the page or disable content blockers, then try again.',
  captcha_unavailable: 'The security check could not load. Refresh the page or try another browser.',
  form_code_incorrect: 'That code is not correct. Check the email and try again.',
  form_code_expired: 'That code has expired. Send a new code and try again.',
  form_identifier_exists: 'An account already exists for that email. Sign in instead.',
  form_identifier_not_found: 'Check the email address and try again.',
  form_param_format_invalid: 'Check the highlighted information and try again.',
  form_password_compromised: 'For your security, reset this password before signing in.',
  form_password_incorrect: 'That email or password is incorrect.',
  form_password_length_too_long: 'Use a shorter password.',
  form_password_length_too_short: 'Use a password with at least 8 characters.',
  form_password_matches_identifier: 'Your password cannot match your email address. Choose a different password.',
  form_password_no_lowercase: 'Add at least one lowercase letter.',
  form_password_no_number: 'Add at least one number.',
  form_password_no_special_char: 'Add at least one special character.',
  form_password_no_uppercase: 'Add at least one uppercase letter.',
  form_password_not_strong_enough: 'Choose a stronger password and try again.',
  form_password_or_identifier_incorrect: 'That email or password is incorrect.',
  form_password_pwned: 'That password has appeared in a data breach. Choose another one.',
  form_password_size_in_bytes_exceeded: 'That password is too long. Choose a shorter one.',
  form_password_validation_failed: 'That password is not valid. Check it and try again.',
  fraud_action_blocked: 'We could not confirm this request. Wait a moment, then try again.',
  fraud_device_blocked: 'We could not confirm this request from this device. Try another browser or contact support.',
  fraud_rate_limit_exceeded: 'Too many attempts. Wait a few minutes, then try again.',
  fraud_sign_up_rate_limit_exceeded: 'Too many account-creation attempts. Wait a few minutes, then try again.',
  network_error: 'We could not connect. Check your internet connection and try again.',
  clerk_offline: 'We could not connect. Check your internet connection and try again.',
  resource_forbidden: 'Account creation is not available right now. Please contact support if you need access.',
  session_exists: 'You are already signed in. Refresh GlideLingo to continue.',
  sign_up_mode_restricted: 'Account creation is not available right now. Please contact support if you need access.',
  sign_up_mode_restricted_waitlist: 'New accounts are currently limited. Please join the waitlist or contact support.',
  strategy_for_user_invalid: 'Password sign-in is not available for this account. Use another sign-in method or reset your password.',
  too_many_requests: 'Too many attempts. Wait a few minutes, then try again.',
  user_locked: 'Your account is temporarily locked. Reset your password or contact support.',
};

type ClerkErrorLike = {
  code?: unknown;
  errors?: unknown;
  meta?: unknown;
};

export type AuthIssueField = 'email' | 'password' | 'confirmation' | 'code' | 'captcha';

export type AuthIssue = {
  field: AuthIssueField | null;
  message: string;
};

const AUTH_ERROR_FIELDS: Record<string, AuthIssueField> = {
  captcha_client_attempts_exceeded: 'captcha',
  captcha_invalid: 'captcha',
  captcha_missing: 'captcha',
  captcha_missing_token: 'captcha',
  captcha_script_failed_to_load: 'captcha',
  captcha_unavailable: 'captcha',
  form_code_expired: 'code',
  form_code_incorrect: 'code',
  form_identifier_exists: 'email',
  form_identifier_not_found: 'email',
  form_password_compromised: 'password',
  form_password_incorrect: 'password',
  form_password_length_too_long: 'password',
  form_password_length_too_short: 'password',
  form_password_matches_identifier: 'password',
  form_password_no_lowercase: 'password',
  form_password_no_number: 'password',
  form_password_no_special_char: 'password',
  form_password_no_uppercase: 'password',
  form_password_not_strong_enough: 'password',
  form_password_or_identifier_incorrect: 'password',
  form_password_pwned: 'password',
  form_password_size_in_bytes_exceeded: 'password',
  form_password_validation_failed: 'password',
};

const AUTH_FIELD_FALLBACKS: Record<AuthIssueField, string> = {
  captcha: 'Complete the security check and try again.',
  code: 'Check the code and try again.',
  confirmation: 'Check that both passwords match.',
  email: 'Check your email address and try again.',
  password: 'Check your password and try again.',
};

function authErrorCandidates(error: unknown) {
  if (typeof error !== 'object' || error === null) return [];
  const clerkError = error as ClerkErrorLike;
  const nested = Array.isArray(clerkError.errors)
    ? clerkError.errors.filter((item): item is ClerkErrorLike => typeof item === 'object' && item !== null)
    : [];
  return [...nested, clerkError];
}

function fieldFromMeta(meta: unknown): AuthIssueField | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const value = (meta as { paramName?: unknown; name?: unknown }).paramName
    ?? (meta as { name?: unknown }).name;
  if (typeof value !== 'string') return null;
  if (['email', 'email_address', 'emailAddress', 'identifier'].includes(value)) return 'email';
  if (['password', 'new_password'].includes(value)) return 'password';
  if (['code', 'verification_code'].includes(value)) return 'code';
  if (value.includes('captcha')) return 'captcha';
  return null;
}

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

export function emailValidationMessage(value: string) {
  const email = normalizeAuthEmail(value);
  if (!email) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  return null;
}

export function passwordValidationMessage(value: string) {
  if (!value) return 'Enter your password.';
  if (value.length < 8) return 'Use a password with at least 8 characters.';
  return null;
}

export function confirmationValidationMessage(password: string, confirmation: string) {
  if (!confirmation) return 'Confirm your password.';
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}

export function codeValidationMessage(value: string) {
  if (!value.trim()) return 'Enter the verification code.';
  return null;
}

export function safeAuthErrorMessage(error: unknown, fallback: string) {
  return safeAuthIssue(error, fallback).message;
}

export function safeAuthIssue(error: unknown, fallback: string): AuthIssue {
  const candidates = authErrorCandidates(error);
  const recognizedError = candidates.find(
    (candidate) => typeof candidate.code === 'string' && Boolean(AUTH_ERROR_MESSAGES[candidate.code]),
  );
  if (typeof recognizedError?.code === 'string') {
    return {
      field: AUTH_ERROR_FIELDS[recognizedError.code] ?? fieldFromMeta(recognizedError.meta),
      message: AUTH_ERROR_MESSAGES[recognizedError.code],
    };
  }

  const field = candidates.map((candidate) => fieldFromMeta(candidate.meta)).find(Boolean) ?? null;
  return { field, message: field ? AUTH_FIELD_FALLBACKS[field] : fallback };
}

export function unsupportedAuthStateMessage() {
  return 'This account needs an authentication step that GlideLingo does not support yet. Please contact support.';
}
