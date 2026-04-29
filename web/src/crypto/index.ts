// High-level paste encryption: produces a Format v2 envelope ready to POST,
// plus the raw key (URL-safe base64) for the URL fragment.

import {
  IV_BYTES,
  KEY_SIZE_BITS,
  PBKDF2_ITERATIONS,
  RAW_KEY_BYTES,
  SALT_BYTES,
  TAG_SIZE_BITS,
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  deriveAesKey,
  randomBytes,
  utf8Decode,
  utf8Encode,
  zlibCompress,
  zlibDecompress,
} from "./cipher";
import type {
  AssociatedData,
  CipherParams,
  CommentEnvelope,
  Compression,
  Formatter,
  PasteEnvelope,
} from "./format";
import { FORMAT_VERSION } from "./format";

// Default compression mode for new pastes. Zlib gives ~50-70% reduction on
// text; for already-compressed binary attachments the cost is ~5 bytes of
// overhead. Decryption respects whatever mode the envelope declares, so old
// "none" pastes keep working when read.
const DEFAULT_COMPRESSION: Compression = "zlib";

// ─── plaintext shape ─────────────────────────────────────────────────────
// Matches PrivateBin: the encrypted blob is JSON.stringify({ paste, attachment, attachment_name }).
// Attachment is a data URL (e.g. "data:image/png;base64,...").

export type PlainPaste = {
  paste: string;
  attachment?: string;
  attachment_name?: string;
};

// ─── encrypt ─────────────────────────────────────────────────────────────

export type EncryptOptions = {
  plaintext: PlainPaste;
  password?: string;
  expire: string; // "5min" | "10min" | "1hour" | ...
  formatter: Formatter;
  burnAfterRead: boolean;
  openDiscussion: boolean;
};

export type EncryptResult = {
  envelope: PasteEnvelope;
  /** URL-safe base64 of the 32 raw key bytes — goes into the URL fragment. */
  keyB64Url: string;
};

export async function encryptPaste(opts: EncryptOptions): Promise<EncryptResult> {
  const rawKey = randomBytes(RAW_KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const salt = randomBytes(SALT_BYTES);

  const cipherParams: CipherParams = [
    bytesToBase64(iv),
    bytesToBase64(salt),
    PBKDF2_ITERATIONS,
    KEY_SIZE_BITS,
    TAG_SIZE_BITS,
    "aes",
    "gcm",
    DEFAULT_COMPRESSION,
  ];

  const adata: AssociatedData = [
    cipherParams,
    opts.formatter,
    opts.openDiscussion ? 1 : 0,
    opts.burnAfterRead ? 1 : 0,
  ];

  const key = await deriveAesKey(rawKey, opts.password || "", salt, PBKDF2_ITERATIONS);
  const aad = utf8Encode(JSON.stringify(adata));
  let messageBytes = utf8Encode(JSON.stringify(opts.plaintext));
  if (DEFAULT_COMPRESSION === "zlib") {
    messageBytes = await zlibCompress(messageBytes);
  }

  const ctBytes = await aesGcmEncrypt(key, iv, aad, messageBytes);

  return {
    envelope: {
      v: FORMAT_VERSION,
      ct: bytesToBase64(ctBytes),
      adata,
      meta: { expire: opts.expire },
    },
    keyB64Url: bytesToBase64Url(rawKey),
  };
}

// ─── decrypt ─────────────────────────────────────────────────────────────

export class DecryptError extends Error {
  constructor(msg: string, public cause?: unknown) {
    super(msg);
    this.name = "DecryptError";
  }
}

export async function decryptPaste(
  envelope: PasteEnvelope,
  keyB64Url: string,
  password = "",
): Promise<PlainPaste> {
  const adata = envelope.adata;
  const cipher = adata[0];
  const iv = base64ToBytes(cipher[0]);
  const salt = base64ToBytes(cipher[1]);
  const iterations = cipher[2];
  const compression = cipher[7];

  const rawKey = base64UrlToBytes(keyB64Url);
  if (rawKey.length !== RAW_KEY_BYTES) {
    throw new DecryptError(`expected ${RAW_KEY_BYTES}-byte key, got ${rawKey.length}`);
  }

  const key = await deriveAesKey(rawKey, password, salt, iterations);
  const aad = utf8Encode(JSON.stringify(adata));
  const ct = base64ToBytes(envelope.ct);

  let plain: Uint8Array;
  try {
    plain = await aesGcmDecrypt(key, iv, aad, ct);
  } catch (err) {
    throw new DecryptError(
      "decryption failed — wrong key, wrong password, or corrupted ciphertext",
      err,
    );
  }
  if (compression === "zlib") {
    try {
      plain = await zlibDecompress(plain);
    } catch (err) {
      throw new DecryptError("decompression failed — corrupt ciphertext", err);
    }
  }
  try {
    return JSON.parse(utf8Decode(plain)) as PlainPaste;
  } catch (err) {
    throw new DecryptError("decrypted payload is not valid JSON", err);
  }
}

// ─── comments ────────────────────────────────────────────────────────────

export async function encryptComment(args: {
  body: string;
  pasteId: string;
  parentId: string;
  /** raw key bytes from the parent paste — same key encrypts the comment. */
  pasteKey: Uint8Array;
  password?: string;
}): Promise<CommentEnvelope> {
  const iv = randomBytes(IV_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const cipherParams: CipherParams = [
    bytesToBase64(iv),
    bytesToBase64(salt),
    PBKDF2_ITERATIONS,
    KEY_SIZE_BITS,
    TAG_SIZE_BITS,
    "aes",
    "gcm",
    DEFAULT_COMPRESSION,
  ];

  const key = await deriveAesKey(args.pasteKey, args.password || "", salt, PBKDF2_ITERATIONS);
  const aad = utf8Encode(JSON.stringify(cipherParams));
  let message = utf8Encode(JSON.stringify({ comment: args.body }));
  if (DEFAULT_COMPRESSION === "zlib") {
    message = await zlibCompress(message);
  }
  const ct = await aesGcmEncrypt(key, iv, aad, message);

  return {
    v: FORMAT_VERSION,
    ct: bytesToBase64(ct),
    adata: cipherParams,
    pasteid: args.pasteId,
    parentid: args.parentId,
  };
}

export async function decryptComment(
  envelope: CommentEnvelope,
  pasteKey: Uint8Array,
  password = "",
): Promise<{ comment: string }> {
  const cipher = envelope.adata;
  const iv = base64ToBytes(cipher[0]);
  const salt = base64ToBytes(cipher[1]);
  const iterations = cipher[2];
  const compression = cipher[7];

  const key = await deriveAesKey(pasteKey, password, salt, iterations);
  const aad = utf8Encode(JSON.stringify(cipher));
  const ct = base64ToBytes(envelope.ct);

  let plain: Uint8Array;
  try {
    plain = await aesGcmDecrypt(key, iv, aad, ct);
  } catch (err) {
    throw new DecryptError("comment decryption failed", err);
  }
  if (compression === "zlib") {
    try {
      plain = await zlibDecompress(plain);
    } catch (err) {
      throw new DecryptError("comment decompression failed", err);
    }
  }
  return JSON.parse(utf8Decode(plain));
}

export type { PasteEnvelope, CommentEnvelope } from "./format";
