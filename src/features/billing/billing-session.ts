export type RevenueCatIdentityAdapter = {
  configure: (apiKey: string, appUserId: string) => void | Promise<void>;
  logIn: (appUserId: string) => void | Promise<void>;
  logOut: () => void | Promise<void>;
};

/**
 * Serializes RevenueCat identity transitions so one account can never reuse another
 * account's in-memory entitlement snapshot during rapid sign-out or account switching.
 */
export class RevenueCatIdentitySession {
  private readonly adapter: RevenueCatIdentityAdapter;
  private activeUserId: string | null = null;
  private configured = false;
  private hasIdentifiedSession = false;
  private transitionTail: Promise<void> = Promise.resolve();

  constructor(adapter: RevenueCatIdentityAdapter) {
    this.adapter = adapter;
  }

  connect(apiKey: string, appUserId: string) {
    const { normalizedKey, normalizedUserId } = this.validateIdentity(apiKey, appUserId);

    return this.enqueue(() => this.connectIdentity(normalizedKey, normalizedUserId));
  }

  runForUser<T>(apiKey: string, appUserId: string, operation: () => Promise<T>) {
    const { normalizedKey, normalizedUserId } = this.validateIdentity(apiKey, appUserId);

    return this.enqueue(async () => {
      await this.connectIdentity(normalizedKey, normalizedUserId);
      if (this.activeUserId !== normalizedUserId) {
        throw new Error('RevenueCat identity changed before the billing operation began.');
      }
      return operation();
    });
  }

  private validateIdentity(apiKey: string, appUserId: string) {
    const normalizedKey = apiKey.trim();
    const normalizedUserId = appUserId.trim();
    if (!normalizedKey) throw new Error('A RevenueCat public SDK key is required.');
    if (!normalizedUserId) throw new Error('An authenticated user ID is required for billing.');
    return { normalizedKey, normalizedUserId };
  }

  private async connectIdentity(normalizedKey: string, normalizedUserId: string) {
    if (!this.configured) {
      await this.adapter.configure(normalizedKey, normalizedUserId);
      this.configured = true;
      this.hasIdentifiedSession = true;
      this.activeUserId = normalizedUserId;
      return;
    }

    if (this.activeUserId === normalizedUserId) return;

    // Hide the previous owner before the asynchronous identity switch begins.
    this.activeUserId = null;
    if (this.hasIdentifiedSession) {
      await this.adapter.logOut();
      this.hasIdentifiedSession = false;
    }
    await this.adapter.logIn(normalizedUserId);
    this.hasIdentifiedSession = true;
    this.activeUserId = normalizedUserId;
  }

  disconnect() {
    return this.enqueue(async () => {
      this.activeUserId = null;
      if (!this.configured || !this.hasIdentifiedSession) return;

      try {
        await this.adapter.logOut();
        this.hasIdentifiedSession = false;
      } catch (error) {
        // Keep the session marked as identified so a later disconnect retries instead
        // of assuming it is safe to expose another account's state.
        throw error;
      }
    });
  }

  currentUserId() {
    return this.activeUserId;
  }

  private enqueue<T>(transition: () => Promise<T>) {
    const result = this.transitionTail.then(transition, transition);
    this.transitionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
