export const NOTIFICATION_WEB_PERMISSION = "notifications";
// Microphone capture for voice control is reported by Electron as the "media"
// permission — which also covers camera/display. We scope it down to audio only.
export const MICROPHONE_WEB_PERMISSION = "media";

// Writing TO the clipboard (copy buttons: SSH key, diagram source) is
// low-risk; reading FROM it stays denied like everything else.
export const CLIPBOARD_WRITE_WEB_PERMISSION = "clipboard-sanitized-write";

export function shouldAllowWebPermission(permission: string): boolean {
  return (
    permission === NOTIFICATION_WEB_PERMISSION ||
    permission === CLIPBOARD_WRITE_WEB_PERMISSION
  );
}

// Gate for the "media" permission: allow only when every requested media type is
// audio. We never request camera/video, so a video request (from a compromised
// renderer or a future feature) is denied rather than silently auto-granted.
export function shouldAllowAudioCapture(mediaTypes: readonly string[] | undefined): boolean {
  return !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((t) => t === "audio");
}
