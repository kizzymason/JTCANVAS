import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCN from "@/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";
const initialLocale = (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN";
let englishResourcesPromise: Promise<void> | null = null;

function ensureEnglishResources() {
    if (!englishResourcesPromise) {
        englishResourcesPromise = import("@/i18n/locales/en-US")
            .then(({ default: translation }) => {
                i18n.addResourceBundle("en-US", "translation", translation, true, true);
            })
            .catch((error: unknown) => {
                englishResourcesPromise = null;
                throw error;
            });
    }
    return englishResourcesPromise;
}

i18n.use(initReactI18next).init({
    resources: { "zh-CN": { translation: zhCN } },
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

if (initialLocale === "en-US") {
    void ensureEnglishResources().then(() => i18n.changeLanguage("en-US"));
}

export async function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    if (locale === "en-US") await ensureEnglishResources();
    return i18n.changeLanguage(locale);
}

export default i18n;
