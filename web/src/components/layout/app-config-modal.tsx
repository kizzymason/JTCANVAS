import { Alert, Button, Drawer, Form, Input, Select } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { useAccountDrawerStore } from "@/stores/use-account-drawer-store";
import { useModelStore } from "@/stores/use-model-store";
import { useConfigStore, type ConfigTabKey, type ModelCapability } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

/**
 * User-facing preferences only. Channels, API keys, request scripts, WebDAV and storage moved to the
 * admin area because they are platform configuration, not per-user settings.
 */
export function AppConfigPanel({ showDoneButton = false, initialTab = "preferences" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { i18n, t } = useTranslation();
    const locale = (i18n.resolvedLanguage ?? i18n.language) as AppLocale;
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const closeConfigDialog = useConfigStore((state) => state.closeConfigDialog);
    const models = useModelStore((state) => state.models);
    const loadModels = useModelStore((state) => state.load);
    void initialTab;

    useEffect(() => {
        void loadModels();
    }, [loadModels]);

    return (
        <div className="flex flex-col gap-5">
            {models.length ? null : <Alert type="warning" showIcon message={t("config.noModels")} description={t("config.noModelsDescription")} />}

            <Form layout="vertical" requiredMark={false}>
                <div className="mb-2 text-sm font-semibold">{t("config.preferences.interface")}</div>
                <Form.Item label={t("config.preferences.language")} extra={t("config.preferences.languageDescription")} className="mb-6 max-w-xs">
                    <Select
                        value={locale === "en-US" ? "en-US" : "zh-CN"}
                        options={[
                            { value: "zh-CN", label: t("locale.zhCN") },
                            { value: "en-US", label: t("locale.enUS") },
                        ]}
                        onChange={(value) => void changeAppLocale(value)}
                    />
                </Form.Item>

                <div className="mb-2 text-sm font-semibold">{t("config.preferences.defaultModels")}</div>
                <div className="mb-4 grid gap-4 sm:grid-cols-2">
                    {modelGroups.map((group) => (
                        <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                            <ModelPicker value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                        </Form.Item>
                    ))}
                </div>

                <div className="mb-2 text-sm font-semibold">{t("config.preferences.generation")}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                        <Input
                            type="number"
                            min={1}
                            max={15}
                            value={config.canvasImageCount}
                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                        />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                    </Form.Item>
                    <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                        <Input
                            type="number"
                            min={0.25}
                            max={4}
                            step={0.05}
                            value={config.audioSpeed}
                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                        />
                    </Form.Item>
                </div>

                <Form.Item label={t("config.preferences.audioInstructions")} className="mb-4">
                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                </Form.Item>
                <Form.Item label={t("config.preferences.systemPrompt")} className="mb-0">
                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                </Form.Item>
            </Form>

            <div className="flex items-center justify-between border-t border-stone-200 pt-4 text-xs text-stone-500 dark:border-stone-800">
                <span>
                    {t("config.accountHint")}{" "}
                    <button
                        type="button"
                        className="underline"
                        onClick={() => {
                            closeConfigDialog();
                            useAccountDrawerStore.getState().open();
                        }}
                    >
                        {t("navigation.account")}
                    </button>
                </span>
                {showDoneButton ? (
                    <Button type="primary" onClick={closeConfigDialog}>
                        {t("common.done")}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const closeConfigDialog = useConfigStore((state) => state.closeConfigDialog);

    useEffect(() => {
        if (!isConfigOpen) return;
        useAccountDrawerStore.getState().close();
    }, [isConfigOpen]);

    return (
        <Drawer title={t("config.title")} placement="right" size={520} open={isConfigOpen} onClose={closeConfigDialog} destroyOnHidden styles={{ wrapper: { maxWidth: "100%" }, body: { paddingTop: 12 } }}>
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Drawer>
    );
}

function normalizeImageCount(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return "1";
    return String(Math.min(15, Math.max(1, parsed)));
}
