function canvasSample() {
    try {
        const el = document.createElement("canvas");
        el.width = 220;
        el.height = 48;
        const ctx = el.getContext("2d");
        if (!ctx) return "";
        ctx.textBaseline = "top";
        ctx.font = "16px Arial";
        ctx.fillStyle = "#c2410c";
        ctx.fillRect(8, 8, 80, 28);
        ctx.fillStyle = "#1c1917";
        ctx.fillText("JTCANVAS", 12, 14);
        return el.toDataURL().slice(-48);
    } catch {
        return "";
    }
}

function toHex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** First-party device fingerprint. SHA-256 of local signals only — never mixed with IP. */
export async function collectDeviceFingerprint() {
    const parts = [
        String(window.screen.width),
        String(window.screen.height),
        String(window.screen.colorDepth),
        Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        navigator.language || "",
        navigator.platform || "",
        String(navigator.hardwareConcurrency || 0),
        canvasSample(),
    ].join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return toHex(digest);
}

let cachedFingerprint: Promise<string> | null = null;

export function cachedDeviceFingerprint() {
    if (!cachedFingerprint) cachedFingerprint = collectDeviceFingerprint().catch(() => "0".repeat(64));
    return cachedFingerprint;
}
