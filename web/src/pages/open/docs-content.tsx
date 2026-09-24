import { Alert, Anchor, Button, Table, Tabs, Tag, Typography } from "antd";
import { Copy } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { apiBaseUrl } from "@/services/api/reseller";
import { cn } from "@/lib/utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { buildAgentIntegrationPrompt } from "./agent-prompt";

/** Kept as literal text: these are wire-protocol examples, not translated copy. */
function snippets(baseUrl: string) {
    return {
        curlImage: `curl ${baseUrl}/images/generations \\
  -H "Authorization: Bearer $JT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seedream-5.0-lite-NSFW",
    "prompt": "a calico cat napping on a bookshelf, warm afternoon light",
    "n": 1,
    "size": "2048x2048",
    "response_format": "url"
  }'`,
        curlVideo: `# 1. create
curl ${baseUrl}/videos \\
  -H "Authorization: Bearer $JT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "seedance-2-0-fast-NSFW", "prompt": "drone shot over a misty forest", "seconds": 5, "resolution": "720p", "generate_audio": true }'
# => { "id": "video_...", "status": "queued", ... }

# 2. poll until status is "completed"
curl ${baseUrl}/videos/video_xxx -H "Authorization: Bearer $JT_API_KEY"

# 3. download the bytes
curl -L ${baseUrl}/videos/video_xxx/content -H "Authorization: Bearer $JT_API_KEY" -o out.mp4`,
        curlChat: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $JT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-6-astra-special",
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
    model="gpt-6-astra-special",
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
    model="seedream-5.0-lite-NSFW",
    prompt="an origami crane on a desk",
    n=1,
    size="2048x2048",
)
print(image.data[0].url)`,
        sdkNode: `import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.JT_API_KEY, baseURL: "${baseUrl}" });

const completion = await client.chat.completions.create({
    model: "gpt-6-astra-special",
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
    const copyText = useCopyText();

    const errorRows = [
        { status: "400", type: "invalid_request_error", when: t("openPlatform.docs.errors.invalidRequest") },
        { status: "401", type: "invalid_api_key", when: t("openPlatform.docs.errors.invalidApiKey") },
        { status: "402", type: "insufficient_quota", when: t("openPlatform.docs.errors.insufficientQuota") },
        { status: "403", type: "permission_denied", when: t("openPlatform.docs.errors.permissionDenied") },
        { status: "404", type: "model_not_found", when: t("openPlatform.docs.errors.modelNotFound") },
        { status: "429", type: "rate_limit_exceeded", when: t("openPlatform.docs.errors.rateLimited") },
        { status: "502", type: "—", when: t("openPlatform.docs.errors.generation") },
        { status: "500", type: "server_error", when: t("openPlatform.docs.errors.server") },
    ];

    const endpointRows = [
        { method: "GET", path: "/v1/models", mode: t("openPlatform.docs.modes.sync"), note: t("openPlatform.docs.endpointNotes.models") },
        { method: "POST", path: "/v1/images/generations", mode: t("openPlatform.docs.modes.blocking"), note: t("openPlatform.docs.endpointNotes.images") },
        { method: "POST", path: "/v1/images/edits", mode: "同步", note: "图片编辑，JSON 或 multipart；mask 仅用于支持蒙版的模型" },
        { method: "POST", path: "/v1/video/generations", mode: "异步", note: "与 /v1/videos 相同，支持 duration、images、videos、audios" },
        { method: "POST", path: "/api/v3/contents/generations/tasks", mode: "异步", note: "豆包/Ark content 格式；查询同路径加 /{id}，成功状态为 succeeded" },
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
                        <div className="flex flex-wrap items-center gap-3">
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(buildAgentIntegrationPrompt(baseUrl), "Agent 接入提示词已复制")}>复制 Agent 一键接入提示词</Button>
                            <span className="text-sm text-muted-foreground">不含密钥，复制后交给 AI，按需选择您的令牌。</span>
                        </div>
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

                    <Section id="new-models" title="新增模型与计费规则">
                        <Table rowKey="models" size="small" pagination={false} scroll={{ x: 640 }}
                            columns={[{ title: "类型 / 模型 ID", dataIndex: "models" }, { title: "接入与计费", dataIndex: "rule" }]}
                            dataSource={[
                                { models: "gpt-6-astra-special / gpt-6-astra-azure", rule: "本站使用 /v1/chat/completions 文本接口。按实际输入 Token 总量选择阶梯，272,000 以内为第一档；Special 第二档至 9,999,000，Azure 至 1,050,000。普通输入、输出、读缓存和写缓存分别计价。Azure 执行使用 Responses 协议；本站暂不提供原生 Responses 透传、工具调用或多模态文本输入。请求大小仍受本站参数限制。" },
                                { models: "claude-opus-5-kiro / claude-opus-5-ccmax / claude-fable-5-1-stable", rule: "使用 /v1/chat/completions；支持文本和 SSE。按普通输入、输出、读缓存、写缓存分别结算，缓存 Token 不重复按普通输入计费。" },
                                { models: "seed-Character-NSFW", rule: "使用 /v1/chat/completions；输入总量 ≤32,000 和 ≤128,000 两档，分别计算输入与输出；读缓存单独计价。" },
                                { models: "deepseek-v4-1-flash", rule: "使用 /v1/chat/completions；UTC+8 每日 09:00–12:00、14:00–18:00 为基础价 2 倍，其他时段为 1 倍。提交时按高峰费率预冻结，成功后按开始执行时段及实际用量结算，退回差额。" },
                                { models: "seedance-2.0-self-developed-NSFW / seedance-2.5-self-developed-NSFW", rule: "使用 /v1/videos 或 /v1/video/generations，多图、视频、音频参考字段与其他 Seedance 模型相同。2.0 支持 720p / 1080p / 4K，2.5 支持 720p / 1080p，本站当前开放 4–15 秒。是否包含视频参考分别计价。" },
                                { models: "dola-seedream-5-0-pro / seedream-5-0-pro", rule: "使用 /v1/images/generations。按输出总像素 ≤236 万与更大尺寸两档计费；参考图第一张免费，第二张起另计参考费。可用尺寸受本站参数校验约束。" },
                                { models: "seedream-5-0-spg / seedream-5.0-lite", rule: "使用 /v1/images/generations，2K / 4K 按固定张价计费，多图参考使用 image 数组。" },
                            ]} />
                        <p className="text-sm text-muted-foreground">实际开放模型以 /v1/models 为准，人民币价格、阶梯与缓存费率在控制台「模型与价格」查看。预冻结会预留输入缓存写入的较高费用及输出上限，成功后按实际用量结算，失败全额释放。价格在提交时保存，后台调价不改变已提交任务的费率。</p>
                    </Section>

                    <Section id="image-rules" title="图片参数与参考图">
                        <p className="text-sm text-muted-foreground">model 必须使用 /v1/models 返回的 ID。生成与编辑均支持 JSON；编辑也支持 multipart 的 image、image[] 和 mask 文件。参考图可使用公网 URL 或 PNG/JPEG/WebP Base64 data URL。</p>
                        <Table rowKey="field" size="small" pagination={false} scroll={{ x: 640 }}
                            columns={[{ title: "参数", dataIndex: "field", width: 190 }, { title: "规则", dataIndex: "rule" }]}
                            dataSource={[
                                { field: "model / prompt", rule: "必填字符串；提示词最多 20,000 字符。" },
                                { field: "n", rule: "默认 1，最多 15，并受所选模型的生成张数限制。" },
                                { field: "size / resolution", rule: "二者为别名：支持 2K/4K、像素尺寸、比例或 auto；冲突值返回 400。" },
                                { field: "ratio / aspect_ratio", rule: "宽高比，例如 16:9；不得与像素尺寸的比例冲突。" },
                                { field: "image / image_urls", rule: "image 接受单个字符串或数组；image_urls 接受数组。两者同时填写必须相同。" },
                                { field: "quality / background", rule: "quality 支持 auto、low/medium/high、standard/hd、1K/2K/4K；transparent 仅用于支持透明背景的模型。" },
                                { field: "watermark / web_search", rule: "布尔值，Seedream 支持这些选项；其它图片模型不使用这两个选项。" },
                                { field: "response_format", rule: "url（默认）或 b64_json；未配置公网文件地址时回退 Base64。" },
                            ]} />
                        <Alert className="mt-3" type="info" showIcon title="Seedream Lite 尺寸兼容" description="Lite 只提供 2K/4K 时，1024×1024 请求会保留方形比例提升至 2K，按实际 2K 规格冻结和结算。明确需要精确像素时，请先查看模型支持的规格。" />
                    </Section>

                    <Section id="video-rules" title="视频参数与多模态参考">
                        <p className="text-sm text-muted-foreground">支持 /v1/videos、/v1/video/generations、/v1/videos/generations；均先返回任务 ID，再通过同路径加 /{'{id}'} 查询。JSON 与 multipart 图片文件均可；视频、音频参考使用公网 URL。</p>
                        <Table rowKey="field" size="small" pagination={false} scroll={{ x: 640 }}
                            columns={[{ title: "参数", dataIndex: "field", width: 210 }, { title: "规则", dataIndex: "rule" }]}
                            dataSource={[
                                { field: "seconds / duration", rule: "秒数，默认 5；支持数字或数字字符串。Seedance 当前本站配置为 4–15 秒，最终以本站模型配置为准。低于下限直接返回 400。" },
                                { field: "resolution / size", rule: "resolution 支持 480p/720p/1080p 或无 p 数字；size 可填像素尺寸或分辨率档位。仅接受所选模型开放的档位。" },
                                { field: "ratio / aspect_ratio", rule: "画幅比例，受模型能力限制；可用 size 指定比例，冲突时返回 400。" },
                                { field: "input_reference", rule: "单个 URL、单个对象或数组；对象可含 image_url、video_url 或 audio_url，值为字符串或 {url: ...}。默认作为参考素材。" },
                                { field: "images / image_urls", rule: "图片链接或 {url, role} 对象数组。没有视频/音频时，1/2 张未指定角色的图片作为首帧/首尾帧；多图作为参考图。" },
                                { field: "reference_images", rule: "始终按参考图处理，不自动转为首尾帧。" },
                                { field: "videos / reference_videos", rule: "视频 URL 数组，角色为 reference_video；按含视价格计费，链接不需要带 .mp4 后缀。" },
                                { field: "audios / reference_audios", rule: "音频 URL 数组，角色为 reference_audio；模型是否允许纯音频参考由所选模型能力决定。" },
                                { field: "role", rule: "图片：first_frame、last_frame、reference_image；视频/音频：reference_video、reference_audio。首尾帧不能与参考模式混用。" },
                                { field: "generate_audio", rule: "默认 true；false 明确关闭生成声音。音频参考和生成声音是不同参数，生成声音不单独加价。" },
                                { field: "watermark / seed / camera_fixed / web_search", rule: "Seedance 支持这些可选参数；具体组合以所选模型的能力和校验结果为准。" },
                                { field: "n", rule: "默认 1，最多 4；按秒数 × 条数预扣，多条只结算成功生成的部分。" },
                                { field: "metadata / content", rule: "metadata 可放上述视频选项；content 支持 Ark 的 text/image_url/video_url/audio_url 数组。重复参数必须一致，参考素材选择一种表达形式。" },
                            ]} />
                        <p className="mt-3 text-sm text-muted-foreground">参考素材全部提交，不会截掉第 7 个之后的输入。超出所选模型支持的数量或组合会明确失败并释放冻结额度；平台不会承诺所有模型都支持同一组参考能力。</p>
                        <Code text={JSON.stringify({ model: "seedance-2-0-fast-NSFW", prompt: "参考图片中的角色，沿参考视频的运动轨迹行走，配合参考音频节奏", duration: 5, resolution: "720p", ratio: "16:9", input_reference: [{ image_url: "https://cdn.example.com/character.png" }, { image_url: "https://cdn.example.com/scene.png" }], reference_videos: ["https://cdn.example.com/motion.mp4"], reference_audios: ["https://cdn.example.com/rhythm.mp3"], generate_audio: true }, null, 2)} />
                        <Code text={JSON.stringify({ id: "task-id", task_id: "task-id", object: "video", status: "completed", progress: 100, seconds: "5", url: "https://your-site.example/signed-video-url", data: [{ url: "https://your-site.example/signed-video-url" }], error: null }, null, 2)} />
                        <p className="mt-3 text-sm text-muted-foreground">标准状态：queued → in_progress → completed / failed。失败原因在 error.message；成功后的 url/data 为临时签名链接，过期后重新查询。GET /v1/videos/{'{id}'}/content 下载首条视频，多条结果使用 data。Ark 路径成功为 succeeded，链接在 content.video_url。</p>
                    </Section>

                    <Section id="model-types" title="按模型类型接入">
                        <p className="text-sm text-muted-foreground">先用 /v1/models 获取令牌可用模型，再在控制台模型价格中查看当前规格和数量限制。下列名称需与返回 ID 完全一致；后台可随时停用或调整能力，请直接使用本站返回的 ID。</p>
                        <Tabs items={[
                            { key: "seedream", label: "Seedream 图片", children: <>
                                <p className="text-sm text-muted-foreground">接口：POST /v1/images/generations；带 image 或 image_urls 即为参考图生成，支持多图融合。/v1/images/edits 也可提交相同参数，但必须有参考图，Seedream 不支持 mask 蒙版。</p>
                                <Table rowKey="model" size="small" pagination={false} scroll={{ x: 620 }} columns={[{ title: "模型 ID", dataIndex: "model" }, { title: "分辨率规则", dataIndex: "rule" }]} dataSource={[
                                    { model: "seedream-5.0-lite-NSFW", rule: "2K / 4K，默认 2K；1024×1024 兼容提升为 2048×2048，按 2K 计费。" },
                                    { model: "seedream-5.0-pro-NSFW", rule: "1K / 2K / 4K，未指定规格使用模型默认档；建议明确填写 size。" },
                                    { model: "seedream-4.5-NSFW / seedream-4-0-NSFW", rule: "2K / 4K，默认 2K；不支持的低档按最低可用档兼容。" },
                                ]} />
                                <p className="mt-2 text-sm text-muted-foreground">quality 在本站表示计费规格，若同时指定像素尺寸，二者必须属于同一档；比例保持不变。watermark 默认 false，web_search 按需传布尔值，是否生效取决于具体模型。</p>
                                <Code text={JSON.stringify({ model: "seedream-5.0-lite-NSFW", prompt: "将图一的小猫放在图二的花园里", size: "2K", ratio: "16:9", image_urls: ["https://cdn.example.com/cat.png", "https://cdn.example.com/garden.png"], n: 1, watermark: false }, null, 2)} />
                            </> },
                            { key: "gpt-image", label: "GPT Image", children: <>
                                <p className="text-sm text-muted-foreground">使用 gpt-image-2-stable、gpt-image-2-special 等已开放 ID；生成用 /v1/images/generations，参考图编辑用 /v1/images/edits。quality 为 low / medium / high（也兼容本站档位别名），size 指输出尺寸。mask 是单张 PNG/JPEG/WebP 文件或 URL，必须同时提供 image，仅对支持蒙版的模型生效。透明背景仅当本站模型开放 supportsTransparent 时可用。</p>
                                <Code text={JSON.stringify({ model: "gpt-image-2-stable", prompt: "设计一张极简咖啡海报", size: "1024x1024", quality: "low", n: 1, response_format: "b64_json" }, null, 2)} />
                            </> },
                            { key: "gemini", label: "Gemini 图片", children: <>
                                <p className="text-sm text-muted-foreground">本站统一使用 /v1/images/generations，model 为 gemini-3.1-flash-lite-image 或 /v1/models 中的其它 Gemini 图片 ID。参考图通过 image / image_urls 提交，规格只使用本站模型价格中已开放的档位（Flash Lite 当前为 1K）。此接口不接受 generateContent 路径或 generationConfig 请求体。</p>
                                <Code text={JSON.stringify({ model: "gemini-3.1-flash-lite-image", prompt: "绘制一张森林旅行明信片", size: "1K", ratio: "1:1", n: 1 }, null, 2)} />
                            </> },
                            { key: "seedance", label: "Seedance 视频", children: <>
                                <Table rowKey="model" size="small" pagination={false} scroll={{ x: 620 }} columns={[{ title: "模型 ID", dataIndex: "model" }, { title: "本站预置规格", dataIndex: "rule" }]} dataSource={[
                                    { model: "seedance-2-0-fast-NSFW / seedance-2-0-mini-NSFW", rule: "480p、720p；4–15 秒。" },
                                    { model: "seedance-2-0-pro-NSFW", rule: "480p、720p、1080p、4K；4–15 秒，以模型列表实际开放的规格为准。" },
                                    { model: "seedance-2-5-NSFW", rule: "480p、720p、1080p；本站当前 4–15 秒。" },
                                ]} />
                                <p className="mt-2 text-sm text-muted-foreground">Fast、Pro、2.5 共用上方视频接口和多模态字段。多图参考用 reference_images 或带 reference_image 角色的 images；视频和音频分别使用 reference_videos、reference_audios。素材完整参与请求，数量、时长和组合按模型能力校验。默认生成声音，generate_audio 不单独加价；含视频参考使用含视规格。按秒数 × 条数冻结，成功按实际用量结算且不超过冻结额，失败全部释放。</p>
                                <Code text={JSON.stringify({ model: "seedance-2-0-pro-NSFW", duration: 5, resolution: "720p", content: [{ type: "text", text: "参考两张图生成花园中散步的镜头" }, { type: "image_url", image_url: { url: "https://cdn.example.com/cat.png" }, role: "reference_image" }, { type: "image_url", image_url: { url: "https://cdn.example.com/garden.png" }, role: "reference_image" }] }, null, 2)} />
                                <p className="mt-2 text-sm text-muted-foreground">上例也可 POST 到 /api/v3/contents/generations/tasks，然后 GET 同路径 /{'{id}'}；Ark 成功状态为 succeeded，结果位于 content.video_url。</p>
                            </> },
                            { key: "other-video", label: "MiniMax / HappyHorse", children: <>
                                <p className="text-sm text-muted-foreground">共用 /v1/videos 或 /v1/video/generations。MiniMax-H3 必须显式选择 resolution: 768P 或 2K（内部价格规格为 768 / 1440），时长 4–15 秒，文本生视频应填写 ratio。不要套用 Seedance 的默认 720p。支持的图片、视频、音频组合按 H3 模型规则校验，不能只传音频参考。</p>
                                <Code text={JSON.stringify({ model: "MiniMax-H3", prompt: "海边日出，镜头缓缓向前", duration: 5, resolution: "768P", ratio: "16:9", generate_audio: true }, null, 2)} />
                                <p className="mt-2 text-sm text-muted-foreground">MiniMax-H3-special 与 HappyHorse 仅在 /v1/models 列出后使用。HappyHorse 的 t2v / i2v / r2v 分别对应文生、图生、参考生成，不能交换模型用途；其素材组合、分辨率与秒数以当前模型能力为准。这些模型按时长定价，不使用 Seedance 编码像素 token 公式。</p>
                            </> },
                            { key: "text-audio", label: "文本 / 音频边界", children: <>
                                <p className="text-sm text-muted-foreground">文本使用 POST /v1/chat/completions，可选 SSE 流式或普通 JSON。messages 支持文本对话；当前按带角色标签的文本历史处理，不提供工具调用、图片理解或音频输入的完整 Chat 透传。temperature 为 SDK 兼容字段，当前不影响采样。max_completion_tokens 优先于 max_tokens，未指定时使用本站默认输出上限。</p>
                                <p className="mt-2 text-sm text-muted-foreground">视频参考音频已开放，但独立语音合成 /v1/audio/speech 尚未对下游开放。独立语音、Responses 和回调 callback_url 当前不在本站开放范围；未知请求字段会返回 400。</p>
                            </> },
                        ]} />
                    </Section>

                    <Section id="new-api" title="New API 接入与排错">
                        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                            <li>渠道地址填写本站域名根地址（不要重复追加 /v1），密钥填写本站控制台创建的令牌。先调用 /v1/models，再配置完全一致的模型名称或模型映射。</li>
                            <li>图片使用 OpenAI 兼容生图；视频可使用支持 /v1/videos 的通道。使用豆包通道时，本站同时提供 /api/v3/contents/generations/tasks 的 content 兼容入口。</li>
                            <li>检查你安装的 New API 版本及请求体转换规则。部分 Sora 转换路径只取第一张图；多图、视频和音频必须在转发后的 JSON 或 metadata 中完整保留。本站无法恢复下游已经丢弃的字段。</li>
                            <li>未知参数、同义参数冲突和不支持的规格返回 400；400/422 会返回具体参数原因。502 表示生成服务或网关失败，不应仅凭 HTTP 状态判断是 Cloudflare 故障。</li>
                            <li>重复提交使用同一 Idempotency-Key 和相同请求体。网络超时不代表任务失败；先查任务或控制台记录，避免换键反复提交造成重复生成。未传幂等键的请求视为新任务。</li>
                            <li>按秒冻结与结算，失败退回；令牌额度用尽后仍可查询与下载已提交任务，账号/令牌停用或过期仍会拒绝访问。</li>
                        </ol>
                        <p className="mt-3 text-sm text-muted-foreground">请以本站文档列出的端点、参数和模型规格接入。New API 的版本及渠道转换规则可能不同，接入时需确认请求字段完整保留。</p>
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
                            { key: "new-models", href: "#new-models", title: "新增模型与计费规则" },
                            { key: "image-rules", href: "#image-rules", title: "图片参数" },
                            { key: "video-rules", href: "#video-rules", title: "视频与多模态参考" },
                            { key: "model-types", href: "#model-types", title: "按模型类型接入" },
                            { key: "new-api", href: "#new-api", title: "New API 接入" },
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
