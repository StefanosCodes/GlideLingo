import { Linking, Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type PurchasesPackage,
} from 'react-native-purchases';

import { safeManagementUrl } from '@/features/billing/billing-errors';
import { selectRevenueCatApiKey, type RevenueCatPlatform } from '@/features/billing/billing-config';
import { reconcilePostPurchaseCustomerInfo } from '@/features/billing/billing-reconciliation';
import { RevenueCatIdentitySession } from '@/features/billing/billing-session';
import {
  type BillingInterval,
  type BillingPackage,
  type BillingSnapshot,
  REVENUECAT_ENTITLEMENT_ID,
} from '@/features/billing/billing-types';

const identitySession = new RevenueCatIdentitySession({
  configure: (apiKey, appUserId) => Purchases.configure({ apiKey, appUserID: appUserId }),
  logIn: async (appUserId) => {
    await Purchases.logIn(appUserId);
  },
});

function runtimePlatform(): RevenueCatPlatform {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return 'web';
}

function platformApiKey() {
  return selectRevenueCatApiKey({
    development: __DEV__,
    platform: runtimePlatform(),
    testKey: process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
    iosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    androidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    webKey: process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY,
  });
}

function hasProEntitlement(customerInfo: CustomerInfo) {
  return customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID] !== undefined;
}

function billingInterval(item: PurchasesPackage): BillingInterval {
  if (item.packageType === Purchases.PACKAGE_TYPE.MONTHLY) return 'monthly';
  if (item.packageType === Purchases.PACKAGE_TYPE.ANNUAL) return 'annual';
  return 'other';
}

function displayPackages(offering: Awaited<ReturnType<typeof Purchases.getOfferings>>['current']) {
  if (!offering) return [];

  const intervalOrder: Record<BillingInterval, number> = { monthly: 0, annual: 1, other: 2 };
  return offering.availablePackages
    .map<BillingPackage>((item) => ({
      identifier: item.identifier,
      interval: billingInterval(item),
      title: item.product.title,
      description: item.product.description,
      priceLabel: item.product.priceString,
    }))
    .sort((left, right) => intervalOrder[left.interval] - intervalOrder[right.interval]);
}

function snapshot(
  customerInfo: CustomerInfo,
  offering: Awaited<ReturnType<typeof Purchases.getOfferings>>['current'],
): BillingSnapshot {
  return {
    isPro: hasProEntitlement(customerInfo),
    packages: displayPackages(offering),
    managementUrl: safeManagementUrl(customerInfo.managementURL),
  };
}

export function hasRevenueCatApiKey() {
  return Boolean(platformApiKey());
}

async function runForRevenueCatUser<T>(userId: string, operation: () => Promise<T>) {
  const apiKey = platformApiKey();
  if (!apiKey) throw new Error('A RevenueCat public SDK key is required.');

  await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
  return identitySession.runForUser(apiKey, userId, operation);
}

export async function disconnectRevenueCatIdentity() {
  await identitySession.disconnect();
}

export async function loadRevenueCatSnapshot(userId: string): Promise<BillingSnapshot> {
  return runForRevenueCatUser(userId, async () => {
    const [customerInfo, offerings] = await Promise.all([Purchases.getCustomerInfo(), Purchases.getOfferings()]);
    return snapshot(customerInfo, offerings.current);
  });
}

export async function purchaseRevenueCatPackage(userId: string, identifier: string): Promise<BillingSnapshot> {
  return runForRevenueCatUser(userId, async () => {
    const offerings = await Purchases.getOfferings();
    const selectedPackage = offerings.current?.availablePackages.find((item) => item.identifier === identifier);

    if (!selectedPackage) throw new Error('That subscription package is no longer available.');

    const purchaseResult = await Purchases.purchasePackage(selectedPackage);
    // RevenueCat returns updated CustomerInfo after checkout. Fetch once more so
    // Web/Electron immediately reconciles server state; if that network refresh
    // alone fails, retain the authoritative successful purchase result.
    const customerInfo = await reconcilePostPurchaseCustomerInfo(
      purchaseResult.customerInfo,
      () => Purchases.getCustomerInfo(),
    );
    return snapshot(customerInfo, offerings.current);
  });
}

export async function restoreRevenueCatPurchases(userId: string): Promise<BillingSnapshot> {
  return runForRevenueCatUser(userId, async () => {
    const customerInfo = Platform.OS === 'web' ? await Purchases.getCustomerInfo() : await Purchases.restorePurchases();
    const offerings = await Purchases.getOfferings();

    return snapshot(customerInfo, offerings.current);
  });
}

export type RevenueCatManagementResult = {
  opened: boolean;
  snapshot: BillingSnapshot;
};

export async function openRevenueCatCustomerManagement(userId: string): Promise<RevenueCatManagementResult> {
  return runForRevenueCatUser(userId, async () => {
    const [customerInfo, offerings] = await Promise.all([Purchases.getCustomerInfo(), Purchases.getOfferings()]);
    const currentSnapshot = snapshot(customerInfo, offerings.current);
    if (!currentSnapshot.managementUrl) return { opened: false, snapshot: currentSnapshot };

    await Linking.openURL(currentSnapshot.managementUrl);
    return { opened: true, snapshot: currentSnapshot };
  });
}

export function subscribeToRevenueCat(listener: CustomerInfoUpdateListener) {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}

export function revenueCatCustomerHasPro(customerInfo: CustomerInfo) {
  return hasProEntitlement(customerInfo);
}

export function revenueCatCustomerManagementUrl(customerInfo: CustomerInfo) {
  return safeManagementUrl(customerInfo.managementURL);
}
