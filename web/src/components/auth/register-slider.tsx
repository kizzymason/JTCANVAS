import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { createSliderChallenge, verifySlider } from "@/services/api/account";
import { cn } from "@/lib/utils";

type RegisterSliderProps = {
    onToken: (token: string | null) => void;
    disabled?: boolean;
};

/**
 * Register-only slide-to-confirm. Trajectory is checked server-side so an instant jump to the
 * end does not mint a token.
 */
export function RegisterSlider({ onToken, disabled }: RegisterSliderProps) {
    const { t } = useTranslation();
    const trackRef = useRef<HTMLDivElement>(null);
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [ratio, setRatio] = useState(0);
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const drag = useRef<{ active: boolean; start: number; points: number[] } | null>(null);

    const resetChallenge = async () => {
        setRatio(0);
        setVerified(false);
        onToken(null);
        try {
            const result = await createSliderChallenge();
            setChallengeId(result.challengeId);
        } catch {
            setChallengeId(null);
        }
    };

    useEffect(() => {
        void resetChallenge();
        return () => onToken(null);
        // Fresh challenge each time the register panel mounts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const measure = (clientX: number) => {
        const track = trackRef.current;
        if (!track) return 0;
        const rect = track.getBoundingClientRect();
        const thumb = 36;
        const max = Math.max(1, rect.width - thumb - 8);
        return Math.min(1, Math.max(0, (clientX - rect.left - 4 - thumb / 2) / max));
    };

    const finish = async (next: number, points: number[], startedAt: number) => {
        if (next < 0.98 || !challengeId || points.length < 8) {
            setRatio(0);
            return;
        }
        setBusy(true);
        try {
            const result = await verifySlider({
                challengeId,
                durationMs: Date.now() - startedAt,
                points,
            });
            setRatio(1);
            setVerified(true);
            onToken(result.token);
        } catch {
            await resetChallenge();
        } finally {
            setBusy(false);
        }
    };

    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (disabled || verified || busy) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const startedAt = Date.now();
        const first = measure(event.clientX);
        drag.current = { active: true, start: startedAt, points: [first] };
        setRatio(first);
    };

    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const state = drag.current;
        if (!state?.active) return;
        const next = measure(event.clientX);
        state.points.push(next);
        setRatio(next);
    };

    const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        const state = drag.current;
        if (!state?.active) return;
        state.active = false;
        const next = measure(event.clientX);
        state.points.push(next);
        setRatio(next);
        void finish(next, state.points, state.start);
        drag.current = null;
    };

    return (
        <div className="mb-4">
            <p className="mb-2 text-sm text-stone-600 dark:text-stone-400">{t("auth.sliderLabel")}</p>
            <div
                ref={trackRef}
                className={cn(
                    "relative h-11 rounded-md bg-black/5 p-1 dark:bg-white/10",
                    verified && "bg-emerald-500/10 dark:bg-emerald-400/10",
                )}
            >
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-1 left-1 rounded-sm bg-stone-900/10 dark:bg-white/10"
                    style={{ width: `calc(${ratio * 100}% - 0.25rem)` }}
                />
                <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-stone-500">
                    {verified ? t("auth.sliderPassed") : t("auth.sliderHint")}
                </p>
                <button
                    type="button"
                    aria-label={t("auth.sliderLabel")}
                    disabled={disabled || verified || busy}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="absolute top-1 size-9 touch-none rounded-sm bg-background shadow-sm dark:bg-stone-700"
                    style={{ left: `calc(0.25rem + ${ratio} * (100% - 2.75rem))` }}
                />
            </div>
        </div>
    );
}
