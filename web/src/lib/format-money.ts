const moneyFormatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
});

/** Formats decimal API values without converting monetary strings through floating-point arithmetic. */
export function formatMoney(value: string | number | undefined) {
    if (value === undefined || value === "") return "0.00";
    // Intl's decimal-string input preserves the exact value; the cast only bridges older TypeScript lib signatures.
    return moneyFormatter.format(String(value) as unknown as number);
}
