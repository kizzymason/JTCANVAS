import { getEncoding, getEncodingNameForModel, type Tiktoken, type TiktokenEncoding } from "js-tiktoken";

/**
 * Prompt tokens have to be counted before the call, because the freeze has to be an upper bound on
 * what settlement can charge. Encoders are built lazily and cached: constructing one parses a few
 * hundred kilobytes of ranks, which is far too slow to repeat per request.
 */
const DEFAULT_ENCODING: TiktokenEncoding = "o200k_base";
const encoders = new Map<TiktokenEncoding, Tiktoken>();

function encodingFor(model: string): TiktokenEncoding {
    if (!model) return DEFAULT_ENCODING;
    try {
        return getEncodingNameForModel(model as Parameters<typeof getEncodingNameForModel>[0]);
    } catch {
        // Unknown model names are the norm here: upstream aggregators invent their own aliases.
        return DEFAULT_ENCODING;
    }
}

function encoderFor(model: string) {
    const name = encodingFor(model);
    let encoder = encoders.get(name);
    if (!encoder) {
        encoder = getEncoding(name);
        encoders.set(name, encoder);
    }
    return encoder;
}

/** Token count for a single string. Falls back to a deliberate over-estimate if encoding fails. */
export function countTextTokens(text: string, model = "") {
    if (!text) return 0;
    try {
        return encoderFor(model).encode(text, "all").length;
    } catch {
        // Over-estimating is the safe direction: it inflates the freeze, never the charge.
        return Math.ceil(text.length / 2);
    }
}

/**
 * Head-room added to a locally counted prompt before it becomes a freeze.
 *
 * Settlement bills the token counts the upstream reports, but it can never exceed what was frozen,
 * so a short freeze is a permanent shortfall. Measured against WhatsToken: a prompt we counted as 7
 * tokens was billed as 118, the difference being the relay's own system framing. 512 covers that
 * framing with margin, and the unused part of the freeze is released on settlement, so the caller
 * never actually pays for it.
 */
export const PROMPT_TOKEN_OVERHEAD = 512;

/** Freeze basis for a prompt: what we can measure, plus the upstream framing we cannot. */
export function billableInputTokens(text: string, model = "") {
    return countTextTokens(text, model) + PROMPT_TOKEN_OVERHEAD;
}

export type ChatMessageLike = {
    role?: string;
    content?: unknown;
};

/** Flattens OpenAI content parts (string, or an array of `{ type: "text", text }`) into plain text. */
export function flattenMessageContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
                return (part as { text: string }).text;
            }
            return "";
        })
        .filter(Boolean)
        .join("\n");
}

/**
 * Prompt tokens for a chat request. The per-message overhead mirrors OpenAI's documented framing
 * cost (4 tokens per message plus 3 for the reply primer) so the freeze is not systematically short.
 */
export function countChatTokens(messages: ChatMessageLike[], model = "") {
    let total = 3;
    for (const message of messages) {
        total += 4;
        total += countTextTokens(String(message.role ?? ""), model);
        total += countTextTokens(flattenMessageContent(message.content), model);
    }
    return total;
}
