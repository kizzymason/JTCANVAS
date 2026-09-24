import { Alert, App, Button, InputNumber, Popconfirm } from "antd";
import { useState } from "react";
import { adminApi, type AdminChannel } from "@/services/api/admin";
import { ApiError } from "@/services/api/client";

export function ChannelRepricing({ channel, onSaved }: { channel: AdminChannel; onSaved: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const [percent, setPercent] = useState<string | null>(channel.markupPercent || "30");
    const [busy, setBusy] = useState(false);
    const [skipped, setSkipped] = useState<Array<{ model: string; reason: string }>>([]);
    const apply = async () => {
        if (percent === null) return;
        setBusy(true);
        try {
            const result = await adminApi.repriceChannel(channel.id, percent);
            setSkipped(result.skipped);
            message.success(`已重新计算 ${result.modelsUpdated} 个模型、${result.pricesUpdated} 条价格`);
            await onSaved();
            if (result.skipped.length) modal.warning({ title: "部分模型保留原价", content: <ul>{result.skipped.map((item) => <li key={item.model}>{item.model}：{item.reason}</li>)}</ul> });
        } catch (error) { message.error(error instanceof ApiError ? error.message : "重新定价失败"); }
        finally { setBusy(false); }
    };
    return <div className="mb-4 flex flex-col gap-2">
        <span>WhatsToken 成本加价幅度</span>
        <div className="flex flex-wrap gap-2">
            <InputNumber<string> stringMode min="0" precision={6} value={percent} onChange={setPercent} addonAfter="%" aria-label="成本加价幅度" />
            <Popconfirm title="应用加价并重新计算此渠道全部模型？" description="已知成本的模型价格将覆盖，包括已停用模型；正在生成的任务保留原价。" onConfirm={apply} disabled={busy || percent === null}>
                <Button loading={busy} disabled={percent === null}>应用并一键重新定价</Button>
            </Popconfirm>
        </div>
        <p className="text-xs text-stone-500">售价 = 美元成本 × 7.2 × (1 + 加价百分比)。默认 30%。点击重新定价后保存并生效；缺少成本或有自定义规格的模型保留原价，最低收费保持不变。</p>
        {skipped.length > 0 && <Alert type="warning" title="以下模型未重新定价" description={<ul>{skipped.map((item) => <li key={item.model}>{item.model}：{item.reason}</li>)}</ul>} />}
    </div>;
}
