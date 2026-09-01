import Papa from "papaparse";

import i18n from "@/i18n";
/** Parsed row shape; the pool itself lives on the server and is managed from the admin area. */
export type PiapiAccountInput = { username: string; apiKey: string };

export type PiapiCsvParseResult = {
    accounts: PiapiAccountInput[];
    invalidRows: number;
};

const USERNAME_HEADERS = ["username", "user", "email", "account", "用户名", "账号"];
const API_KEY_HEADERS = ["api key", "apikey", "api_key", "key", "密钥"];

function pickColumn(row: Record<string, string>, candidates: string[]) {
    for (const [header, value] of Object.entries(row)) {
        if (candidates.includes(header.trim().toLowerCase())) return (value || "").trim();
    }
    return "";
}

/** Accepts the CSV exported by the PiAPI registrar tool (`ID,Username,Status,API Key,Cookie Token,...`). */
export function parsePiapiAccountCsv(text: string): PiapiCsvParseResult {
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (header) => header.replace(/^\uFEFF/, "").trim() });
    const accounts: PiapiAccountInput[] = [];
    const seen = new Set<string>();
    let invalidRows = 0;

    for (const row of parsed.data) {
        const apiKey = pickColumn(row, API_KEY_HEADERS);
        if (!apiKey) {
            invalidRows += 1;
            continue;
        }
        if (seen.has(apiKey)) continue;
        seen.add(apiKey);
        accounts.push({ username: pickColumn(row, USERNAME_HEADERS), apiKey });
    }

    if (!accounts.length) throw new Error(i18n.t("admin.piapi.csvNoAccounts"));
    return { accounts, invalidRows };
}
