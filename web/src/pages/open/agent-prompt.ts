/** Shared by the public reference and the authenticated token console. Never persisted. */
export function buildAgentIntegrationPrompt(baseUrl: string, apiKey?: string, modelScope: string[] = []) {
    const origin = baseUrl.replace(/\/v1\/?$/, "");
    return `请作为我的开发 Agent，将现有项目接入此 API 开放平台，完成配置、实现、错误处理和验证。

连接配置：
- Base URL: ${baseUrl}
- API 文档: ${origin}/open/docs
- 鉴权: Authorization: Bearer <JT_API_KEY>
${apiKey ? `- JT_API_KEY: ${apiKey}` : "- 本提示词未包含密钥。请让我选择控制台中的令牌并在本地环境变量或密钥管理器中设置 JT_API_KEY；不要猜测或生成密钥。"}
${modelScope.length ? `- 此令牌的模型范围: ${modelScope.join(", ")}` : "- 可用模型以 GET /v1/models 返回结果为准。"}

实施步骤：
1. 先阅读上述本站文档和现有项目结构，识别需要的图片、视频或文本能力，沿用项目现有 SDK/请求封装。所有请求使用上述本站地址。
2. 密钥只保存在服务端环境变量或密钥管理器中，不写进前端代码、Git、日志、测试快照或交付报告；示例只写变量名。若提示词包含密钥，配置后不要再回显。
3. 先携带鉴权调用 GET ${baseUrl}/models，使用返回的准确 model ID；再核对文档中对应模型的规格、参考素材和数量限制。不得只凭模型名称猜测能力。
4. 图片: POST ${baseUrl}/images/generations，同步返回 {created,data:[{url 或 b64_json}]}。JSON 必填 model/prompt；n 默认 1。image 接受单个 URL 或数组，image_urls 接受数组；编辑用 /images/edits，可发 JSON 或 multipart 图片。Seedream Lite 仅 2K/4K 时，1024x1024 会按 2K 兼容并计费，建议 size=2K。size/resolution、ratio/aspect_ratio 是别名，不传冲突值。
5. 视频: POST ${baseUrl}/videos（也支持 /video/generations），立即取得 id；GET ${baseUrl}/videos/{id} 轮询 queued/in_progress，直到 completed/failed。成功读 url/data，或 GET /videos/{id}/content 下载首条；多条结果使用 data。seconds/duration 默认 5，Seedance 当前 4–15 秒；resolution 依模型选择 480p/720p/1080p 等。MiniMax-H3 显式选 768P 或 2K。
6. 视频多模态: input_reference 可为单对象或数组，如 [{image_url:"图片URL1"},{image_url:"图片URL2"}]；reference_images 是多图参考；reference_videos 和 reference_audios 为公网 URL 数组。首帧/尾帧使用 images 的 first_frame/last_frame 角色，不能与 reference_* 模式混用。generate_audio 默认 true。素材不可静默截断或丢字段。
7. Ark 兼容视频: POST ${origin}/api/v3/contents/generations/tasks，content 使用 text/image_url/video_url/audio_url 部件；查询同路径/{id}，成功状态 succeeded，结果 content.video_url。
8. 文本: POST ${baseUrl}/chat/completions，messages 使用文本，支持 stream=true 的 SSE 与 [DONE]；max_completion_tokens 设置输出上限。当前不提供完整多模态 Chat、工具调用或独立 /audio/speech。temperature 仅兼容接收，不影响采样。
9. 错误格式为 {error:{message,type,code,param}}。400 修正参数；401/403 检查令牌、权限和 IP；402 检查余额或额度；429 按 Retry-After 等待；5xx 记录脱敏错误并查任务状态。不要盲目重试付费创建。非流式创建使用稳定 Idempotency-Key 和相同请求体；网络断开不代表任务失败，视频应复用已有 id 查询。
10. 若经 New API 接入，渠道地址填写 ${origin}，不要重复追加 /v1；配置准确模型映射，检查转发后的 metadata/content/参考数组是否完整。请保留用户已有配置，仅修改本次接入所需内容。
11. 先运行配置、鉴权、模型查询和参数校验等无生成费用验证；实际付费生成按我选择的模型、功能及预算执行。交付可运行代码、环境变量模板、调用示例及已验证/待验证清单，不承诺未经测试的能力。`;
}
