import type { ThemeConfig } from "antd";
import { theme } from "antd";

import type { FrontendTheme } from "@/stores/use-frontend-theme-store";

export const brandPalettes = {
    dark: {
        background: "#090b0d",
        panel: "#14171a",
        elevated: "#1b1f23",
        text: "#f5f7fa",
        muted: "#969fa6",
        line: "#2c3136",
        primary: "#c3fa55",
        primaryText: "#090b0d",
        hover: "#202428",
        selected: "#24282c",
        selectedHover: "#2b3034",
        tableHeader: "#171b1f",
        tableHover: "#1d2226",
        infoBg: "#181c20",
        infoBorder: "#30363c",
    },
    light: {
        background: "#ffffff",
        panel: "#f7f8fa",
        elevated: "#ffffff",
        text: "#171717",
        muted: "#626b75",
        line: "#e3e6ea",
        primary: "#111111",
        primaryText: "#ffffff",
        hover: "#f1f3f5",
        selected: "#e9ecef",
        selectedHover: "#e1e5e9",
        tableHeader: "#f5f6f7",
        tableHover: "#f7f8fa",
        infoBg: "#f5f6f7",
        infoBorder: "#e3e6ea",
    },
} as const;

/** Brand tokens are independent of the separately persisted administrator theme. */
export function getBrandAntTheme(mode: FrontendTheme): ThemeConfig {
    const palette = brandPalettes[mode];
    const dark = mode === "dark";

    return {
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        cssVar: { key: "gravity" },
        token: {
            colorPrimary: palette.primary,
            colorInfo: palette.primary,
            colorLink: palette.primary,
            colorLinkHover: dark ? "#d2ff76" : "#000000",
            colorBgBase: palette.background,
            colorBgContainer: palette.panel,
            colorBgElevated: palette.elevated,
            colorText: palette.text,
            colorTextSecondary: palette.muted,
            colorTextLightSolid: palette.primaryText,
            colorBorder: palette.line,
            colorBorderSecondary: palette.line,
            controlItemBgHover: palette.hover,
            controlItemBgActive: palette.selected,
            controlItemBgActiveHover: palette.selectedHover,
            borderRadius: 8,
            controlHeight: 38,
            fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif',
        },
        components: {
            Button: {
                colorPrimary: palette.primary,
                colorPrimaryHover: dark ? "#d2ff76" : "#000000",
                colorPrimaryActive: dark ? "#aedf42" : "#2a2a2a",
                primaryColor: palette.primaryText,
                primaryShadow: "none",
                defaultShadow: "none",
            },
            Layout: {
                headerBg: palette.background,
                bodyBg: palette.background,
                siderBg: palette.background,
                headerColor: palette.text,
            },
            Menu: {
                itemBg: "transparent",
                popupBg: palette.elevated,
                itemSelectedBg: palette.selected,
                itemSelectedColor: palette.primary,
                itemHoverBg: palette.hover,
                darkItemBg: palette.background,
                darkPopupBg: palette.elevated,
                darkItemSelectedBg: palette.selected,
                darkItemSelectedColor: palette.primary,
            },
            Tooltip: { colorBgSpotlight: palette.elevated, colorTextLightSolid: palette.text },
            Dropdown: { colorBgElevated: palette.elevated },
            Select: { optionSelectedBg: palette.selected, optionSelectedColor: palette.primary, optionActiveBg: palette.hover },
            Table: { headerBg: palette.tableHeader, rowHoverBg: palette.tableHover, rowSelectedBg: palette.selected, rowSelectedHoverBg: palette.selectedHover },
            Card: { boxShadowTertiary: "none" },
            Tabs: { itemSelectedColor: palette.primary, inkBarColor: palette.primary },
            Modal: { contentBg: palette.panel, headerBg: palette.panel, footerBg: palette.panel },
            Drawer: { colorBgElevated: palette.panel },
            Alert: { colorInfoBg: palette.infoBg, colorInfoBorder: palette.infoBorder },
        },
    };
}
