type Verification = { status?: string | null } | null;

export type AccountIdentity = {
  displayName: string;
  contact: string;
  verificationLabel: 'VERIFIED' | 'VERIFICATION REQUIRED' | 'CONTACT NOT AVAILABLE';
  verified: boolean;
};

type AccountUser = {
  firstName?: string | null;
  fullName?: string | null;
  primaryEmailAddress?: { emailAddress: string; verification?: Verification } | null;
  primaryPhoneNumber?: { phoneNumber: string; verification?: Verification } | null;
};

export function hasFirstName(firstName: string | null | undefined) {
  return Boolean(firstName?.trim());
}

export function normalizedFirstName(firstName: string) {
  return firstName.trim();
}

export function accountIdentity(user: AccountUser): AccountIdentity {
  const email = user.primaryEmailAddress;
  const phone = user.primaryPhoneNumber;
  const primaryContact = email ?? phone;
  const status = primaryContact?.verification?.status;
  const verified = status === 'verified';
  const contact = email?.emailAddress ?? phone?.phoneNumber ?? 'No verified contact method';
  const verificationLabel = primaryContact
    ? verified
      ? 'VERIFIED'
      : 'VERIFICATION REQUIRED'
    : 'CONTACT NOT AVAILABLE';

  return {
    contact,
    displayName: user.firstName?.trim() || user.fullName?.trim() || 'GlideLingo learner',
    verificationLabel,
    verified,
  };
}
