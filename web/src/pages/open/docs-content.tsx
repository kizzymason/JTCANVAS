import { Alert, Anchor, Table, Tabs, Tag, Typography } from "antd";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { apiBaseUrl } from "@/services/api/reseller";
import { cn } from "@/lib/utils";

/** Kept as literal text: these are wire-protocol examples, not translated copy. */
function snippets(baseUrl: string) {
    return {
        curlImage: `curl ${baseUrl}/images/generations \\
  -H "Authorization: Bearer $JT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seedream-4-0-250828",
    "prompt": "a calico cat napping on a bookshelf, warm afternoon light",
    "n": 1,
    "size": "1024x1024",
    "response_format": "url"
  }'`,
        curlVideo: `# 1. create
curl ${baseUrl}/videos \\
  -H "Authorization: Bearer $JT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "seedance-1-0-pro-250528", "prompt": "drone shot over a misty forest", "seconds": 5, "resolution": "720" }'
# => { "id": "video_...", "status": "queued", ... }

# 2. poll until status is "completed"
curl ${baseUrl}/videos/video_xxx -H "Authorization: Bearer $JT_API_KEY"

# 3. download the bytes
curl -L ${baseUrl}/videos/video_xxx/content -H "Authorization: Bearer $JT_API_KEY" -o out.mp4`,
        curlChat: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $JT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.1",
    "messages": [{ "role": "user", "content": "Say hello in one short sentence." }],
    "max_completion_tokens": 256,
    "stream": true,
    "stream_options": { "include_usage": true }
  }'`,
        curlModels: `curl ${baseUrl}/models -H "Authorization: Bearer $JT_API_KEY"`,
        sdkPython: `from openai import OpenAI

client = OpenAI(api_key="sk-jt-...", base_url="${baseUrl}")

# text, streaming
stream = client.chat.completions.create(
    model="gpt-5.1",
    messages=[{"role": "user", "content": "Write a haiku about latency."}],
    max_completion_tokens=256,
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta.content if chunk.choices else None
    if delta:
        print(delta, end="")

# image, synchronous
image = client.images.generate(
    model="seedream-4-0-250828",
    prompt="an origami crane on a desk",
    n=1,
    size="1024x1024",
)
print(image.data[0].url)`,
        sdkNode: `import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.JT_API_KEY, baseURL: "${baseUrl}" });

const completion = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [{ role: "user", content: "Explain idempotency in one sentence." }],
    max_completion_tokens: 256,
});
console.log(completion.choices[0].message.content);
console.log(completion.usage);`,
        errorEnvelope: `{
  "error": {
    "message": "Incorrect API key provided.",
    "type": "invalid_api_key",
    "code": "invalid_api_key",
    "param": null
  }
}`,
    };
}

/**
 * The API reference, rendered both as the public `/open/docs` page and inside the console so a
 * signed-in reseller never has to leave the console to read it. Both hosts clip their children, so
 * this owns its scrolling and points the anchor at that same element instead of the window.
 */
export default function OpenPlatformDocsContent({ variant = "page" }: { variant?: "page" | "embedded" }) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const baseUrl = apiBaseUrl();
    const code = snippets(baseUrl);

    const errorRows = [
        { status: "400", type: "invalid_request_error", when: t("openPlatform.docs.errors.invalidRequest") },
        { status: "401", type: "invalid_api_key", when: t("openPlatform.docs.errors.invalidApiKey") },
        { status: "402", type: "insufficient_quota", when: t("openPlatform.docs.errors.insufficientQuota") },
        { status: "403", type: "permission_denied", when: t("openPlatform.docs.errors.permissionDenied") },
        { status: "404", type: "model_not_found", when: t("openPlatform.docs.errors.modelNotFound") },
        { status: "429", type: "rate_limit_exceeded", when: t("openPlatform.docs.errors.rateLimited") },
        { status: "502", type: "upstream_error", when: t("openPlatform.docs.errors.upstream") },
        { status: "500", type: "server_error", when: t("openPlatform.docs.errors.server") },
    ];

    const endpointRows = [
        { method: "GET", path: "/v1/models", mode: t("openPlatform.docs.modes.sync"), note: t("openPlatform.docs.endpointNotes.models") },
        { method: "POST", path: "/v1/images/generations", mode: t("openPlatform.docs.modes.blocking"), note: t("openPlatform.docs.endpointNotes.images") },
        { method: "POST", path: "/v1/videos", mode: t("openPlatform.docs.modes.async"), note: t("openPlatform.docs.endpointNotes.videoCreate") },
        { method: "GET", path: "/v1/videos/{id}", mode: t("openPlatform.docs.modes.poll"), note: t("openPlatform.docs.endpointNotes.videoRetrieve") },
        { method: "GET", path: "/v1/videos/{id}/content", mode: t("openPlatform.docs.modes.download"), note: t("openPlatform.docs.endpointNotes.videoContent") },
        { method: "POST", path: "/v1/chat/completions", mode: t("openPlatform.docs.modes.stream"), note: t("openPlatform.docs.endpointNotes.chat") },
    ];

    return (
        <div ref={scrollRef} className="h-full overflow-y-auto bg-background">
            <div className={cn("mx-auto flex w-full max-w-6xl gap-10", variant === "page" ? "px-6 py-12" : "pb-4")}>
                <article className="flex min-w-0 flex-1 flex-col gap-10">
                    <header className="flex flex-col gap-3">
                        <Tag color="gold" className="w-fit uppercase tracking-[0.2em]">
                            {t("openPlatform.docs.badge")}
                        </Tag>
                        <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t("openPlatform.docs.title")}</h1>
                        <p className="max-w-3xl text-base text-stone-600 dark:text-stone-300">{t("openPlatform.docs.subtitle")}</p>
                        {variant === "page" ? (
                            <p className="text-sm text-stone-500">
                                {t("openPlatform.docs.applyPrompt")}{" "}
                                <Link to="/open" className="underline">
                                    {t("openPlatform.docs.applyLink")}
                                </Link>
                            </p>
                        ) : null}
                    </header>

                    <Section id="quickstart" title={t("openPlatform.docs.quickstart")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.quickstartBody")}</p>
                        <Field label={t("openPlatform.docs.baseUrl")} value={baseUrl} />
                        <Field label={t("openPlatform.docs.authHeader")} value="Authorization: Bearer sk-jt-..." />
                        <Alert className="mt-3" type="info" showIcon message={t("openPlatform.docs.compatTitle")} description={t("openPlatform.docs.compatBody")} />
                    </Section>

                    <Section id="auth" title={t("openPlatform.docs.auth")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.authBody")}</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
                            <li>{t("openPlatform.docs.authRules.prefix")}</li>
                            <li>{t("openPlatform.docs.authRules.once")}</li>
                            <li>{t("openPlatform.docs.authRules.scope")}</li>
                            <li>{t("openPlatform.docs.authRules.ip")}</li>
                        </ul>
                    </Section>

                    <Section id="endpoints" title={t("openPlatform.docs.endpoints")}>
                        <Table
                            rowKey="path"
                            size="small"
                            pagination={false}
                            dataSource={endpointRows}
                            columns={[
                                { title: t("openPlatform.docs.method"), dataIndex: "method", width: 80, render: (value: string) => <Tag color={value === "GET" ? "blue" : "green"}>{value}</Tag> },
                                { title: t("openPlatform.docs.path"), dataIndex: "path", render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                                { title: t("openPlatform.docs.mode"), dataIndex: "mode", width: 110 },
                                { title: t("openPlatform.docs.note"), dataIndex: "note" },
                            ]}
                        />
                    </Section>

                    <Section id="examples" title={t("openPlatform.docs.examples")}>
                        <Tabs
                            items={[
                                { key: "image", label: t("openPlatform.docs.tabs.image"), children: <Code text={code.curlImage} /> },
                                { key: "video", label: t("openPlatform.docs.tabs.video"), children: <Code text={code.curlVideo} /> },
                                { key: "chat", label: t("openPlatform.docs.tabs.chat"), children: <Code text={code.curlChat} /> },
                                { key: "models", label: t("openPlatform.docs.tabs.models"), children: <Code text={code.curlModels} /> },
                            ]}
                        />
                    </Section>

                    <Section id="sdk" title={t("openPlatform.docs.sdk")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.sdkBody")}</p>
                        <Tabs
                            items={[
                                { key: "python", label: "Python", children: <Code text={code.sdkPython} /> },
                                { key: "node", label: "Node.js", children: <Code text={code.sdkNode} /> },
                            ]}
                        />
                    </Section>

                    <Section id="streaming" title={t("openPlatform.docs.streaming")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.streamingBody")}</p>
                        <Code
                            text={`data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}

data: [DONE]`}
                        />
                    </Section>

                    <Section id="errors" title={t("openPlatform.docs.errorsTitle")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.errorsBody")}</p>
                        <Code text={code.errorEnvelope} />
                        <Table
                            className="mt-3"
                            rowKey="type"
                            size="small"
                            pagination={false}
                            dataSource={errorRows}
                            columns={[
                                { title: "HTTP", dataIndex: "status", width: 80 },
                                { title: "type", dataIndex: "type", width: 200, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
                                { title: t("openPlatform.docs.when"), dataIndex: "when" },
                            ]}
                        />
                    </Section>

                    <Section id="limits" title={t("openPlatform.docs.limits")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.limitsBody")}</p>
                        <Field label="x-ratelimit-limit-requests" value={t("openPlatform.docs.headerLimit")} />
                        <Field label="x-ratelimit-remaining-requests" value={t("openPlatform.docs.headerRemaining")} />
                        <Field label="Retry-After" value={t("openPlatform.docs.headerRetry")} />
                    </Section>

                    <Section id="billing" title={t("openPlatform.docs.billing")}>
                        <p className="text-sm text-stone-600 dark:text-stone-300">{t("openPlatform.docs.billingBody")}</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
                            <li>{t("openPlatform.docs.billingRules.freeze")}</li>
                            <li>{t("openPlatform.docs.billingRules.settle")}</li>
                            <li>{t("openPlatform.docs.billingRules.multiplier")}</li>
                            <li>{t("openPlatform.docs.billingRules.tokens")}</li>
                        </ul>
                    </Section>
                </article>

                <aside className="hidden w-48 shrink-0 lg:block">
                    <Anchor
                        affix={false}
                        className="sticky top-6"
                        getContainer={() => scrollRef.current ?? window}
                        items={[
                            { key: "quickstart", href: "#quickstart", title: t("openPlatform.docs.quickstart") },
                            { key: "auth", href: "#auth", title: t("openPlatform.docs.auth") },
                            { key: "endpoints", href: "#endpoints", title: t("openPlatform.docs.endpoints") },
                            { key: "examples", href: "#examples", title: t("openPlatform.docs.examples") },
                            { key: "sdk", href: "#sdk", title: t("openPlatform.docs.sdk") },
                            { key: "streaming", href: "#streaming", title: t("openPlatform.docs.streaming") },
                            { key: "errors", href: "#errors", title: t("openPlatform.docs.errorsTitle") },
                            { key: "limits", href: "#limits", title: t("openPlatform.docs.limits") },
                            { key: "billing", href: "#billing", title: t("openPlatform.docs.billing") },
                        ]}
                    />
                </aside>
            </div>
        </div>
    );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <section id={id} className="scroll-mt-6">
            <h2 className="mb-3 text-xl font-semibold text-stone-950 dark:text-stone-100">{title}</h2>
            {children}
        </section>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="mt-2 flex flex-wrap items-baseline gap-2 rounded border border-stone-200 px-3 py-2 dark:border-stone-800">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</span>
            <Typography.Text copyable={{ text: value }} className="break-all font-mono text-xs">
                {value}
            </Typography.Text>
        </div>
    );
}

function Code({ text }: { text: string }) {
    return (
        <div className="relative mt-2 overflow-hidden rounded border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
            <div className="absolute right-2 top-2 z-[1]">
                <Typography.Text copyable={{ text }} />
            </div>
            <pre className="hide-scrollbar overflow-x-auto p-3 pr-10 font-mono text-xs leading-relaxed text-stone-800 dark:text-stone-200">{text}</pre>
        </div>
    );
}
