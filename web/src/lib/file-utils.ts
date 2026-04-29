// File / data-URL helpers used by the attachment flow.

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export type DataUrlInfo = {
  mime: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isPdf: boolean;
  /** Approximate decoded byte size — base64 inflates payloads ~33%. */
  approxBytes: number;
};

export function inspectDataUrl(dataUrl: string): DataUrlInfo {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  const mime = m?.[1] || "application/octet-stream";
  const b64Length = m ? m[2].length : 0;
  return {
    mime,
    isImage: mime.startsWith("image/"),
    isVideo: mime.startsWith("video/"),
    isAudio: mime.startsWith("audio/"),
    isPdf: mime === "application/pdf",
    approxBytes: Math.floor((b64Length * 3) / 4),
  };
}

/** Programmatic download of a data URL with a filename. */
export function downloadDataUrl(name: string, dataUrl: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
