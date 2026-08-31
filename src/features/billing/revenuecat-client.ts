import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type CustomerInfoUpdateListener,
} from 'react-native-purchases';

import { selectRevenueCatApiKey, type RevenueCatPlatform } from '@/features/billing/billing-config';
import { RevenueCatIdentitySession } from '@/features/billing/billing-session';
import {
  type BillingPackage,
  type BillingSnapshot,
  REVENUECAT_ENTITLEMENT_ID,
} from '@/features/billing/billing-types';

const identitySession = new RevenueCatIdentitySession({
  configure: (apiKey, appUserId) => Purchases.configure({ apiKey, appUserID: appUserId }),
  logIn: async (appUserId) => {
    await Purchases.logIn(appUserId);
  },
  logOut: async () => {
    await Purchases.logOut();
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

function displayPackages(offering: Awaited<ReturnType<typeof Purchases.getOfferings>>['current']) {
  if (!offering) return [];

  return offering.availablePackages.map<BillingPackage>((item) => ({
    identifier: item.identifier,
    title: item.product.title,
    description: item.product.description,
    priceLabel: item.product.priceString,
  }));
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

    return {
      isPro: hasProEntitlement(customerInfo),
      packages: displayPackages(offerings.current),
    };
  });
}

export async function purchaseRevenueCatPackage(userId: string, identifier: string): Promise<BillingSnapshot> {
  return runForRevenueCatUser(userId, async () => {
    const offerings = await Purchases.getOfferings();
    const selectedPackage = offerings.current?.availablePackages.find((item) => item.identifier === identifier);

    if (!selectedPackage) throw new Error('That subscription package is no longer available.');

    const { customerInfo } = await Purchases.purchasePackage(selectedPackage);
    return {
      isPro: hasProEntitlement(customerInfo),
      packages: displayPackages(offerings.current),
    };
  });
}

export async function restoreRevenueCatPurchases(userId: string): Promise<BillingSnapshot> {
  return runForRevenueCatUser(userId, async () => {
    const customerInfo = Platform.OS === 'web' ? await Purchases.getCustomerInfo() : await Purchases.restorePurchases();
    const offerings = await Purchases.getOfferings();

    return {
      isPro: hasProEntitlement(customerInfo),
      packages: displayPackages(offerings.current),
    };
  });
}

export function subscribeToRevenueCat(listener: CustomerInfoUpdateListener) {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}

export function revenueCatCustomerHasPro(customerInfo: CustomerInfo) {
  return hasProEntitlement(customerInfo);
}

export function isPurchaseCancellation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'userCancelled' in error && error.userCancelled);
}
