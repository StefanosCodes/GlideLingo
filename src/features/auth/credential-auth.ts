export const AUTH_CODE_RESEND_SECONDS = 30;

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  captcha_invalid: 'We could not confirm this request. Please try again.',
  captcha_missing: 'Please complete the security check and try again.',
  form_code_incorrect: 'That code is not correct. Check the email and try again.',
  form_code_expired: 'That code has expired. Send a new code and try again.',
  form_identifier_exists: 'An account already exists for that email. Sign in instead.',
  form_identifier_not_found: 'We could not find an account for that email.',
  form_param_format_invalid: 'Check the highlighted information and try again.',
  form_password_incorrect: 'That email or password is incorrect.',
  form_password_length_too_short: 'Use a password with at least 8 characters.',
  form_password_not_strong_enough: 'Choose a stronger password and try again.',
  form_password_pwned: 'That password has appeared in a data breach. Choose another one.',
  session_exists: 'You are already signed in. Refresh GlideLingo to continue.',
  strategy_for_user_invalid: 'Password sign-in is not available for this account.',
  too_many_requests: 'Too many attempts. Wait a moment, then try again.',
};

type ClerkErrorLike = {
  code?: unknown;
  errors?: unknown;
};

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
  if (typeof error !== 'object' || error === null) return fallback;

  const clerkError = error as ClerkErrorLike;
  const codes = [
    clerkError.code,
    ...(Array.isArray(clerkError.errors)
      ? clerkError.errors.map((item) => (
          typeof item === 'object' && item !== null ? (item as ClerkErrorLike).code : undefined
        ))
      : []),
  ];
  const recognizedCode = codes.find(
    (code): code is string => typeof code === 'string' && Boolean(AUTH_ERROR_MESSAGES[code]),
  );
  return recognizedCode ? AUTH_ERROR_MESSAGES[recognizedCode] : fallback;
}

export function unsupportedAuthStateMessage() {
  return 'This account needs an authentication step that GlideLingo does not support yet. Please contact support.';
}
