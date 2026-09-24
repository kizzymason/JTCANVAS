import { useEffect } from "react";
import { App } from "antd";
import { useSearchParams } from "react-router-dom";
import { homepageApi } from "@/services/api/homepage";

/** Read only: copying an inspiration can never enqueue a generation. */
export function useShowcasePrompt(kind: "image" | "video", setPrompt: (prompt: string) => void) {
    const [params, setParams] = useSearchParams();
    const { message } = App.useApp();
    const id = params.get("showcase");
    useEffect(() => {
        if (!id) return;
        let active = true;
        homepageApi.work(id).then((work) => {
            if (!active) return;
            if (work.kind !== kind) throw new Error("作品类型与当前工作台不匹配");
            setPrompt(work.prompt);
            message.success("已带入提示词，请确认参数后生成");
        }).catch(() => { if (active) message.warning("作品不存在、已下架或暂时无法读取"); }).finally(() => {
            if (!active) return;
            setParams((previous) => { const next = new URLSearchParams(previous); next.delete("showcase"); return next; }, { replace: true });
        });
        return () => { active = false; };
    }, [id, kind, message, setParams, setPrompt]);
}
