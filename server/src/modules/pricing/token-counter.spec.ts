import { describe, expect, it } from "vitest";
import { billableInputTokens, countChatTokens, countTextTokens, flattenMessageContent, PROMPT_TOKEN_OVERHEAD } from "./token-counter";

describe("billableInputTokens", () => {
    it("adds head-room for the upstream's own framing so the freeze is not short", () => {
        // The relay counted 118 tokens for a prompt we measure at ~7; settlement can only ever bill
        // up to the freeze, so the freeze has to cover that gap.
        const prompt = "Reply with exactly: pong";
        expect(billableInputTokens(prompt)).toBe(countTextTokens(prompt) + PROMPT_TOKEN_OVERHEAD);
        expect(billableInputTokens(prompt)).toBeGreaterThan(118);
    });

    it("still reserves the head-room for an empty prompt", () => {
        expect(billableInputTokens("")).toBe(PROMPT_TOKEN_OVERHEAD);
    });
});

describe("token counter", () => {
    it("counts an empty string as zero tokens", () => {
        expect(countTextTokens("")).toBe(0);
    });

    it("counts ascii and CJK text plausibly", () => {
        expect(countTextTokens("hello world")).toBeGreaterThan(0);
        expect(countTextTokens("hello world")).toBeLessThan(6);
        const cjk = countTextTokens("请生成一段关于夏日海边的描述");
        expect(cjk).toBeGreaterThan(4);
        expect(cjk).toBeLessThan(40);
    });

    it("still returns a count for a model name it has never seen", () => {
        expect(countTextTokens("hello", "seedream-4-0-250828")).toBeGreaterThan(0);
    });

    it("flattens both string content and OpenAI content parts", () => {
        expect(flattenMessageContent("plain")).toBe("plain");
        expect(flattenMessageContent([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
        expect(flattenMessageContent([{ type: "image_url", image_url: { url: "http://x" } }])).toBe("");
        expect(flattenMessageContent(undefined)).toBe("");
    });

    it("adds per-message framing overhead so the freeze is not short", () => {
        const single = countChatTokens([{ role: "user", content: "hi" }]);
        const double = countChatTokens([
            { role: "user", content: "hi" },
            { role: "assistant", content: "hi" },
        ]);
        expect(single).toBeGreaterThan(countTextTokens("hi"));
        expect(double).toBeGreaterThan(single);
    });
});
