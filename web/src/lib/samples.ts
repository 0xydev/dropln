// Sample paste content used by the editor's "Insert sample" menu and as
// the default placeholder demo for the prototype/dev view.

export const SAMPLE_CONTENT: Record<string, string> = {
  log: `[2026-04-28 14:22:31.408] ERROR  api.payments.charge        request_id=req_8f3a2c1b
TypeError: Cannot read properties of undefined (reading 'customer_id')
    at chargeCard (services/payments.ts:142:18)
    at processOrder (workers/order-pipeline.ts:88:9)
    at async OrderQueue.consume (workers/queue.ts:217:5)

context: {
  order_id:    "ord_01JTQK9N4PZ8X5VYZ",
  amount_cents: 4990,
  currency:    "USD",
  retry_count: 2,
  upstream:    "stripe",
}

> Suspected cause: webhook payload missing customer_id when source = "subscription_invoice".
> Recovery: requeue with --enrich-customer flag, or patch via /admin/orders/:id/recharge.`,
  ts: `import { encrypt, decrypt } from "@/crypto/aes-gcm";

export interface PasteOptions {
  burnAfterRead: boolean;
  expiresIn: ExpiryWindow;
  password?: string;
  discussion: boolean;
}

/**
 * Encrypts a paste client-side and returns the URL fragment key.
 * The server never sees plaintext or the key.
 */
export async function createPaste(content: string, opts: PasteOptions) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const ciphertext = await encrypt(content, key, opts.password);
  const id = await api.uploadCiphertext(ciphertext, opts);
  return \`/p/\${id}#\${await exportKey(key)}\`;
}`,
  env: `# .env.production
DATABASE_URL=postgresql://app:hunter2@db.internal:5432/ulakbin
REDIS_URL=redis://cache.internal:6379/0
SESSION_SECRET=2f9c1e7a44b6e8d310f5ba9e72cd31a87b5f0e4d92c8a16f3e7d50b9c4a18f6d
S3_BUCKET=ulakbin-prod-objects
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
STRIPE_SECRET_KEY=sk_live_REDACTED_BEFORE_COMMIT_PLEASE
SENTRY_DSN=https://abc123@sentry.io/4506

# Feature flags
ENABLE_DISCUSSIONS=true
DEFAULT_EXPIRY_MIN=10080
MAX_PASTE_BYTES=2097152`,
};
