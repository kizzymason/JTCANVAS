/**
 * Deterrents against casually poking at a page. Read this before relying on any of it.
 *
 * None of this is a security measure and it cannot be made into one: the code runs on the visitor's
 * machine, so disabling JavaScript, a proxy, `view-source:`, or remote debugging from a phone all
 * walk straight past it. Treat it as a speed bump for casual snooping; the real boundary for the
 * card shop is server-side (payment must settle, and codes need the order's access token).
 *
 * Two deliberate carve-outs, because getting them wrong breaks the product:
 * - anything marked `data-allow-copy` keeps its context menu and text selection, since a buyer who
 *   cannot copy a card code has not received their purchase;
 * - keyboard shortcuts unrelated to inspection are left alone, so normal editing still works.
 */

const DEVTOOLS_KEYS = new Set(["I", "J", "C"]);
/** A gap this large between outer and inner size normally means docked devtools. */
const DEVTOOLS_SIZE_DELTA = 180;
const BLUR_CLASS = "anti-inspect-blur";

function allowsCopy(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("[data-allow-copy]"));
}

function onContextMenu(event: MouseEvent) {
    if (allowsCopy(event.target)) return;
    event.preventDefault();
}

function onSelectStart(event: Event) {
    if (allowsCopy(event.target)) return;
    const target = event.target;
    // Never fight with real inputs: blocking selection there would break typing an e-mail.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
}

function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toUpperCase();
    if (key === "F12") {
        event.preventDefault();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && DEVTOOLS_KEYS.has(key)) {
        event.preventDefault();
        return;
    }
    // Ctrl+U (view source), but not inside a field where it may be a legitimate shortcut.
    if ((event.ctrlKey || event.metaKey) && key === "U" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
    }
}

/**
 * Installs the deterrents and returns a cleanup function. Safe to call from an effect; it does
 * nothing during server rendering.
 */
export function installAntiInspect() {
    if (typeof window === "undefined") return () => undefined;

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectstart", onSelectStart);
    document.addEventListener("keydown", onKeyDown);

    // Heuristic only: blurs sensitive areas while devtools looks open, and unblurs when it closes.
    const probe = window.setInterval(() => {
        const open = window.outerWidth - window.innerWidth > DEVTOOLS_SIZE_DELTA || window.outerHeight - window.innerHeight > DEVTOOLS_SIZE_DELTA;
        document.documentElement.classList.toggle(BLUR_CLASS, open);
    }, 1000);

    return () => {
        document.removeEventListener("contextmenu", onContextMenu);
        document.removeEventListener("selectstart", onSelectStart);
        document.removeEventListener("keydown", onKeyDown);
        window.clearInterval(probe);
        document.documentElement.classList.remove(BLUR_CLASS);
    };
}
