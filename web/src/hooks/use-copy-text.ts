import { App } from "antd";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

export function useCopyText() {
    const { message } = App.useApp();
    const { t } = useTranslation();

    return async (value: string, successText = t("common.copied")) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            if (!copy(value)) {
                message.error("复制失败，请检查浏览器剪贴板权限后重试");
                return false;
            }
        }
        message.success(successText);
        return true;
    };
}
