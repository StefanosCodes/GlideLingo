export const REVENUECAT_ENTITLEMENT_ID = 'pro';

export type BillingMode = 'mock' | 'revenuecat' | 'unavailable';

export type BillingStatus = 'signed-out' | 'loading' | 'free' | 'pro' | 'error';

export type BillingPackage = {
  identifier: string;
  title: string;
  description: string;
  priceLabel: string;
};

export type BillingSnapshot = {
  isPro: boolean;
  packages: BillingPackage[];
};
