export const REVENUECAT_ENTITLEMENT_ID = 'pro';

export type BillingMode = 'mock' | 'revenuecat' | 'unavailable';

export type BillingStatus = 'signed-out' | 'loading' | 'free' | 'pro' | 'error';

export type BillingInterval = 'monthly' | 'annual' | 'other';

export type BillingPurchaseStatus = 'idle' | 'loading' | 'success' | 'cancelled' | 'declined' | 'error';

export type BillingManagementStatus = 'idle' | 'loading' | 'opened' | 'unavailable' | 'error';

export type BillingPackage = {
  identifier: string;
  interval: BillingInterval;
  title: string;
  description: string;
  priceLabel: string;
};

export type BillingSnapshot = {
  isPro: boolean;
  packages: BillingPackage[];
  managementUrl: string | null;
};

export type BillingPurchaseState = {
  packageIdentifier: string | null;
  status: BillingPurchaseStatus;
  message: string | null;
};

export type BillingManagementState = {
  status: BillingManagementStatus;
  message: string | null;
};
