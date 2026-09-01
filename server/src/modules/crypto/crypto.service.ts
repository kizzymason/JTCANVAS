import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * AES-256-GCM for provider credentials at rest. Ciphertext is stored alongside the key id that produced
 * it, so `APP_ENCRYPTION_KEY` can be rotated: add the new key, re-encrypt lazily, retire the old id.
 */
@Injectable()
export class CryptoService {
    private readonly logger = new Logger(CryptoService.name);
    private readonly keys = new Map<string, Buffer>();
    private readonly activeKeyId: string;

    constructor(config: ConfigService) {
        this.activeKeyId = config.get<string>("encryption.keyId")!;
        this.keys.set(this.activeKeyId, decodeKey(config.get<string>("encryption.key")!));

        // Retired keys stay available for decryption only: APP_ENCRYPTION_KEY_OLD_<id>=<key>
        for (const [name, value] of Object.entries(process.env)) {
            const match = name.match(/^APP_ENCRYPTION_KEY_OLD_(.+)$/);
            if (match && value) this.keys.set(match[1], decodeKey(value));
        }
    }

    get currentKeyId() {
        return this.activeKeyId;
    }

    /** HMAC-SHA256 over a capability string, e.g. short-lived public file tokens. */
    hmac(message: string) {
        return createHmac("sha256", this.key(this.activeKeyId)).update(message).digest("base64url");
    }

    encrypt(plaintext: string): { cipher: string; keyId: string } {
        if (!plaintext) return { cipher: "", keyId: "" };
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, this.key(this.activeKeyId), iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        // iv | tag | ciphertext, base64 encoded as a single column value.
        return { cipher: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"), keyId: this.activeKeyId };
    }

    decrypt(cipherText: string, keyId: string): string {
        if (!cipherText) return "";
        const raw = Buffer.from(cipherText, "base64");
        if (raw.length <= IV_LENGTH + TAG_LENGTH) throw new Error("Ciphertext is truncated");
        const decipher = createDecipheriv(ALGORITHM, this.key(keyId || this.activeKeyId), raw.subarray(0, IV_LENGTH));
        decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
        return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
    }

    /** Re-encrypts under the active key. Returns null when it is already current. */
    rotate(cipherText: string, keyId: string) {
        if (!cipherText || keyId === this.activeKeyId) return null;
        return this.encrypt(this.decrypt(cipherText, keyId));
    }

    /** Last 4 characters, for identifying a key in the admin UI without decrypting it. */
    static tail(plaintext: string) {
        return plaintext.length > 4 ? plaintext.slice(-4) : plaintext;
    }

    static mask(tail: string) {
        return tail ? `••••••••${tail}` : "";
    }

    private key(keyId: string) {
        const key = this.keys.get(keyId);
        if (!key) {
            this.logger.error(`No encryption key registered for keyId "${keyId}"`);
            throw new Error(`Unknown encryption key id: ${keyId}`);
        }
        return key;
    }
}

/** Constant-time comparison for opaque tokens; never use === on a secret. */
export function safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

function decodeKey(value: string) {
    const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
    if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes");
    return key;
}
