// Low-level crypto primitives. No React, no app concepts — just byte-level
// operations matching PrivateBin Format v2: AES-256-GCM, PBKDF2-SHA256 (100k
// iterations), 16-byte IV, 8-byte salt, 32-byte raw key.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 100000;
export const KEY_SIZE_BITS = 256;
export const TAG_SIZE_BITS = 128;
export const IV_BYTES = 16;
export const SALT_BYTES = 8;
export const RAW_KEY_BYTES = 32;

// ─── byte helpers ─────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// URL-safe base64 (no padding) for the URL fragment key. Easy to decode in JS
// and lets the user copy/paste without escaping.
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return base64ToBytes(b64);
}

export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ─── key derivation ───────────────────────────────────────────────────────

// PrivateBin's derivation: PBKDF2(rawKey || password, salt, iterations) → 256-bit AES key.
// rawKey is the 32 random bytes whose URL-safe base64 lives in the URL fragment.
export async function deriveAesKey(
  rawKey: Uint8Array,
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = concatBytes(rawKey, enc.encode(password));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    material,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_SIZE_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ─── encrypt / decrypt with AAD ───────────────────────────────────────────

export async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: TAG_SIZE_BITS },
    key,
    plaintext,
  );
  return new Uint8Array(ct);
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: TAG_SIZE_BITS },
    key,
    ct,
  );
  return new Uint8Array(plain);
}

export const utf8Encode = (s: string) => enc.encode(s);
export const utf8Decode = (b: Uint8Array) => dec.decode(b);

// ─── compression (zlib / RFC 1950) ────────────────────────────────────────
// CompressionStream("deflate") emits zlib-format bytes (header + raw deflate
// + Adler-32 trailer) — matches PrivateBin's "zlib" mode and Pako defaults.
// Available in Chrome 80+, Firefox 113+, Safari 16.4+ — modern browsers only.

async function streamThrough(
  bytes: Uint8Array,
  transform: ReadableWritablePair<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
  const blob = new Blob([bytes]);
  const stream = blob.stream().pipeThrough(transform);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function zlibCompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream unavailable — browser too old");
  }
  return streamThrough(bytes, new CompressionStream("deflate"));
}

export async function zlibDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream unavailable — browser too old");
  }
  return streamThrough(bytes, new DecompressionStream("deflate"));
}
