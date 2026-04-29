// TypeScript mirrors of the Go internal/paste types. The wire format must
// stay byte-compatible with FormatV2 (PrivateBin compatible) — see
// reference/privatebin/lib/FormatV2.php and our internal/paste/format.go.

export const FORMAT_VERSION = 2;

export type Algorithm = "aes";
export type Mode = "ctr" | "cbc" | "gcm";
export type Compression = "zlib" | "none";

// CipherParams — wire shape: [iv, salt, iterations, keysize, tagsize, algo, mode, compression]
export type CipherParams = [
  string, // iv (base64)
  string, // salt (base64)
  number, // iterations
  number, // keysize (128/192/256)
  number, // tagsize (64/96/128)
  Algorithm,
  Mode,
  Compression,
];

// Formatter is opaque on the server but the UI uses these well-known values.
export type Formatter = "plaintext" | "syntaxhighlighting" | "markdown";

// AssociatedData — wire shape: [cipher_params, formatter, open_discussion(0|1), burn_after_read(0|1)]
export type AssociatedData = [CipherParams, Formatter, 0 | 1, 0 | 1];

export type PasteEnvelope = {
  v: number;
  ct: string;
  adata: AssociatedData;
  meta: { expire: string };
};

// Comment envelope: adata is flat cipher_params, no meta, replaced by pasteid/parentid.
export type CommentEnvelope = {
  v: number;
  ct: string;
  adata: CipherParams;
  pasteid: string;
  parentid: string;
};
