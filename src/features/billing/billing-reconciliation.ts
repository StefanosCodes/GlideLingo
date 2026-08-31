/**
 * Re-read server CustomerInfo after checkout, while preserving the successful
 * purchase result if that follow-up network request alone fails.
 */
export async function reconcilePostPurchaseCustomerInfo<T>(
  purchaseCustomerInfo: T,
  refreshCustomerInfo: () => Promise<T>,
) {
  try {
    return await refreshCustomerInfo();
  } catch {
    return purchaseCustomerInfo;
  }
}
