const DEVICE_ID_KEY = "ic_device_id";

function toHex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function persistDeviceId() {
    try {
        const existing = window.localStorage.getItem(DEVICE_ID_KEY);
        if (existing && /^[0-9a-f-]{16,64}$/i.test(existing)) return existing;
        const id = crypto.randomUUID();
        window.localStorage.setItem(DEVICE_ID_KEY, id);
        return id;
    } catch {
        return crypto.randomUUID();
    }
}

/**
 * First-party device id for the 365-day registration lock. A persisted UUID is unique per browser
 * and does not use canvas fingerprints (those collide under Safari privacy and stall mobile GPUs).
 * Call this only on register submit — never on page load or visitor beacons.
 */
export async function collectDeviceFingerprint() {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jtcanvas-device:${persistDeviceId()}`));
    return toHex(digest);
}

let cachedFingerprint: Promise<string> | null = null;

export function cachedDeviceFingerprint() {
    if (!cachedFingerprint) {
        cachedFingerprint = collectDeviceFingerprint().catch(async () => {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jtcanvas-device:${crypto.randomUUID()}`));
            return toHex(digest);
        });
    }
    return cachedFingerprint;
}
