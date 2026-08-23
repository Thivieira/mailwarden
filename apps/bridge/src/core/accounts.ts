/**
 * Per-account relay activity.
 *
 * Bridge does not store a mailbox list — Cloud selects the Proton account per
 * request — so "3 accounts connected" is derived from what the relay has
 * actually served recently rather than from anything self-reported.
 */
export interface AccountActivity {
  accountId: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
}

export class AccountActivityTracker {
  private readonly activity = new Map<string, AccountActivity>();

  constructor(private readonly connectedWindowMs = 60 * 60_000) {}

  record(accountId: string, ok: boolean, now = Date.now()): void {
    const entry = this.activity.get(accountId) ?? { accountId };
    if (ok) entry.lastSuccessAt = new Date(now).toISOString();
    else entry.lastFailureAt = new Date(now).toISOString();
    this.activity.set(accountId, entry);
  }

  list(): AccountActivity[] {
    return [...this.activity.values()];
  }

  summary(now = Date.now()): { configured: number; connected: number } {
    let connected = 0;
    for (const entry of this.activity.values()) {
      const at = entry.lastSuccessAt ? Date.parse(entry.lastSuccessAt) : NaN;
      if (Number.isFinite(at) && now - at <= this.connectedWindowMs) connected += 1;
    }
    return { configured: this.activity.size, connected };
  }
}
