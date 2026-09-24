import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { useShowcasePrompt } from "@/hooks/use-showcase-prompt";
import { useCanAffordGeneration } from "@/components/price-estimate";
import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { migrateLegacyImageSize, modelFeaturesOf, normalizeImageResolution } from "@/lib/model-features";
import { pricingSpecFor } from "@/lib/pricing-spec";
import { billedVideoResolution, videoPricingSpecFor } from "@/lib/video-pricing-spec";
import { fileUrl } from "@/services/api/files";
import { ensureReferenceKeys } from "@/services/api/reference-upload";
import type { GenerationTask, SubmitGenerationInput } from "@/services/api/generation";
import { modelOptionName, resolveModelForCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useGenerationWorkbenchStore, type StudioKind } from "@/stores/use-generation-workbench-store";
import { useModelStore } from "@/stores/use-model-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";

export function useStudioComposer(kind: StudioKind) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const update = useConfigStore((state) => state.updateConfig);
    const [prompt, setPrompt] = useState("");
    const [batch, setBatch] = useState(false);
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const submitLock = useRef(false);
    const model = (kind === "image" ? config.imageModel : config.videoModel) || config.model;
    const models = useModelStore((state) => state.models);
    const found = models.find((item) => item.capability === kind && item.value === model);
    const features = modelFeaturesOf(found);
    useShowcasePrompt(kind, setPrompt);
    const prompts = batch ? prompt.split(/\r?\n\s*\r?\n/).map((value) => value.trim()).filter(Boolean) : [prompt.trim()].filter(Boolean);
    const priceInput = {
        count: kind === "image" ? Math.max(1, Number(config.count) || 1) : 1,
        seconds: kind === "video" ? Number(config.videoSeconds) : undefined,
        spec: kind === "image" ? pricingSpecFor(config.quality, config.size) : videoPricingSpecFor(config.vquality, false, modelOptionName(model)),
        referenceCount: references.length,
        taskCount: Math.max(1, prompts.length),
    };
    const { affordable } = useCanAffordGeneration(model, priceInput);

    useEffect(() => {
        if (found) return;
        const fallback = resolveModelForCapability(config, model, kind);
        if (fallback) update(kind === "image" ? "imageModel" : "videoModel", fallback);
    }, [kind, model, models, found, config, update]);

    // Keep model-dependent controls valid using the model catalogue, without inventing new limits.
    useEffect(() => {
        if (!found) return;
        const caps = modelFeaturesOf(found);
        const size = kind === "image" ? migrateLegacyImageSize(config.size).size : normalizeVideoSizeValue(config.size, caps.aspectPresets);
        if (!/^\d+x\d+$/.test(size) && size !== "auto" && !caps.aspectRatios.includes(size)) update("size", caps.aspectRatios[0] || "auto");
        else if (size !== config.size) update("size", size);
        if (kind === "image") {
            const quality = normalizeImageResolution(config.quality);
            const nextQuality = quality === "auto" || caps.resolutions.includes(quality) ? quality : caps.resolutions[0];
            if (nextQuality !== config.quality) update("quality", nextQuality);
            const count = String(Math.max(1, Math.min(caps.maxCount, Math.floor(Number(config.count) || 1))));
            if (count !== config.count) update("count", count);
            if (!caps.supportsTransparent && config.background === "transparent") update("background", "");
        } else {
            const resolution = normalizeVideoResolutionValue(config.vquality);
            const next = caps.videoResolutions.includes(resolution) ? resolution : caps.videoResolutions[0];
            if (next !== config.vquality) update("vquality", next);
        }
    }, [kind, found, config.size, config.quality, config.count, config.background, config.vquality, update]);

    const generate = async (overridePrompt?: string, agentTaskId?: string) => {
        const reject = (error: string) => {
            message.warning(error);
            if (agentTaskId) useWorkbenchAgentStore.getState().updateTask(agentTaskId, { status: "failed", error });
        };
        if (submitLock.current || uploading) { reject("正在提交或上传，请稍后再试"); return; }
        const texts = overridePrompt === undefined ? prompts : [overridePrompt.trim()].filter(Boolean);
        if (!texts.length) { reject("请先描述你想生成的画面"); return; }
        if (!found) { reject("请选择可用的生成模型"); return; }
        if (!affordable) { reject("余额不足，请先充值"); return; }
        const seconds = Number(config.videoSeconds);
        if (kind === "video" && (!Number.isInteger(seconds) || seconds < features.minSeconds || seconds > features.maxSeconds)) {
            reject(seconds < features.minSeconds ? `该模型最低生成时长${features.minSeconds}S` : `该模型生成时长需为 ${features.minSeconds}–${features.maxSeconds} 秒的整数`);
            return;
        }
        // Capture all mutable form data before the first await.
        const snapshot = { ...config };
        const ownerId = useAuthStore.getState().user?.id;
        const referenceSnapshot = [...references];
        const input: SubmitGenerationInput = {
            capability: kind, model, prompt: "", count: kind === "image" ? Number(snapshot.count) : 1,
            size: snapshot.size, source: `${kind}-workbench`,
            ...(kind === "image" ? { quality: snapshot.quality, background: snapshot.background } : {
                seconds, resolution: billedVideoResolution(snapshot.vquality, modelOptionName(model)),
                generateAudio: snapshot.videoGenerateAudio === "true", watermark: snapshot.videoWatermark === "true",
            }),
        };
        submitLock.current = true;
        setSubmitting(true);
        try {
            input.references = await ensureReferenceKeys(referenceSnapshot);
            if (!ownerId || useAuthStore.getState().user?.id !== ownerId) return;
            await useGenerationWorkbenchStore.getState().submit(texts.map((text) => ({ ...input, prompt: text })), agentTaskId);
        } catch (error) { reject(error instanceof Error ? error.message : "参考图处理失败，请重试"); }
        finally { submitLock.current = false; setSubmitting(false); }
    };
    const command = useWorkbenchAgentStore((state) => kind === "image" ? state.imageCommand : state.videoCommand);
    const processed = useRef(0);
    useEffect(() => {
        if (!command || command.nonce === processed.current) return;
        processed.current = command.nonce;
        const store = useWorkbenchAgentStore.getState();
        kind === "image" ? store.clearImageCommand() : store.clearVideoCommand();
        if (command.prompt !== undefined) { setPrompt(command.prompt); setBatch(false); }
        if (command.run) void generate(command.prompt ?? prompt, command.taskId);
        // Commands are consumed once; submission captures the current form snapshot.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [command]);

    const reuse = (task: GenerationTask) => {
        setPrompt(task.prompt);
        setBatch(false);
        const savedModel = useModelStore.getState().models.find((item) => item.capability === kind && item.value === task.model);
        if (savedModel) update(kind === "image" ? "imageModel" : "videoModel", savedModel.value);
        else message.info("原模型当前不可用，请重新选择生成模型");
        const params = task.params;
        if (params.size) update("size", String(params.size));
        if (kind === "image") {
            update("count", String(params.count ?? 1));
            update("quality", String(params.quality || "auto"));
            update("background", String(params.background || ""));
        } else {
            update("videoSeconds", String(params.seconds || 5));
            update("vquality", String(params.resolution || "720"));
            update("videoGenerateAudio", String(params.generateAudio ?? true));
            update("videoWatermark", String(params.watermark ?? false));
        }
        setReferences(Array.isArray(params.references) ? params.references.filter((key): key is string => typeof key === "string").map((key, index) => ({
            id: nanoid(), name: `参考图 ${index + 1}`, type: "image/png", dataUrl: /^https?:\/\//.test(key) ? key : fileUrl(key), ...(/^https?:\/\//.test(key) ? {} : { storageKey: key }),
        })) : []);
    };
    return { prompt, setPrompt, batch, setBatch, references, setReferences, setUploading, submitting, uploading, generate, reuse, model, priceInput, affordable, taskCount: prompts.length };
}
