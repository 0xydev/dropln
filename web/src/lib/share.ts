// Web Share API helper.
//
// Modern mobile browsers (iOS Safari, Android Chrome, Edge mobile,
// Samsung Internet) implement navigator.share, which opens the OS-level
// share sheet — Messages, WhatsApp, Mail, Slack, AirDrop, the works.
// On desktop browsers without it (most), we fall back to clipboard copy.
//
// The user-cancel path is "successful" from our POV: they intentionally
// dismissed the sheet, so we shouldn't redo a clipboard copy as a
// consolation prize.

export type ShareData = {
  url: string;
  title?: string;
  text?: string;
};

export type ShareOutcome =
  | { kind: "shared" }       // OS share sheet completed
  | { kind: "cancelled" }    // user dismissed the sheet
  | { kind: "copied" }       // fell back to clipboard
  | { kind: "failed"; error: unknown };

export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  // Some browsers expose navigator.share but throw for arbitrary URLs
  // (e.g. they require https origin or user-gesture context). Use
  // canShare when available to pre-flight; otherwise just try and
  // catch.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    if (typeof navigator.canShare === "function" && !navigator.canShare(data)) {
      // canShare said no — go straight to clipboard.
    } else {
      try {
        await navigator.share(data);
        return { kind: "shared" };
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return { kind: "cancelled" };
        }
        // Some platforms throw NotAllowedError outside a user gesture —
        // fall through to clipboard rather than break the user's flow.
      }
    }
  }

  // Clipboard fallback.
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(data.url);
      return { kind: "copied" };
    } catch (err) {
      return { kind: "failed", error: err };
    }
  }

  return { kind: "failed", error: new Error("clipboard unavailable") };
}

/** True if the browser would actually open a share sheet (informs UI). */
export function canNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.share === "function"
  );
}
