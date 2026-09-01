/**
 * Playwright launch failures embed the full Chromium command line — several
 * kilobytes of flags that bury the one line that matters. Keep the first
 * meaningful lines and drop the noise before storing or displaying it.
 */
const NOISE = [
  /^\s*<launch(ing|ed)>/i,
  /^\s*-\s*<launch(ing|ed)>/i,
  /^\s*-\s*\[pid=\d+\]/i,
  /^\s*Call log:/i,
  /^\s*Browser logs:/i,
  /^\s*$/,
];

export function condenseError(input: unknown, maxLength = 400): string {
  const raw = input instanceof Error ? input.message : String(input ?? 'Unknown error');

  const lines = raw
    .split('\n')
    .filter((line) => !NOISE.some((pattern) => pattern.test(line)))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Chromium's own ERROR lines are the useful part when a launch fails.
  const chromeError = lines.find((line) => /\[err\].*ERROR:/.test(line));
  const summary = chromeError
    ? `${lines[0]} — ${chromeError.replace(/^.*ERROR:[^\]]*\]\s*/, '').trim()}`
    : lines.slice(0, 3).join(' | ');

  const text = summary || raw.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
