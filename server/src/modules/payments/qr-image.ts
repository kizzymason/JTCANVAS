import qrcode from "qrcode-generator";

/** 每个码点 4px + 2 点留白（约 160px 见方），1 位色 GIF，约 1~2KB。 */
const CELL_SIZE = 4;
const MARGIN = 2;

/**
 * 把二维码内容渲染成可以直接塞进 `<img src>` 的图片（GIF data URL）。
 *
 * 网关给的 `qrcode` 有两种形态：图片地址，以及**二维码内容**本身（景诺支付 / chpay.cc 返回的是本单的
 * `<网关>/pay/submitwap/<trade_no>/` 支付页链接）。下游渠道按文档用 `<img src="${img || qrcode}">` 显示时，
 * 后者会变成一张裂图，所以这里补一张真图片；`qrcode` 字段仍原样返回，供自行渲染二维码的接入方使用。
 *
 * 内容为空或编码失败（例如超长）返回空串：调用方退回只给 `qrcode` / `payUrl`，绝不让下单失败。
 */
export function qrImageDataUrl(content: string): string {
    const text = content.trim();
    if (!text) return "";
    try {
        const matrix = qrcode(0, "M");
        matrix.addData(text);
        matrix.make();
        return matrix.createDataURL(CELL_SIZE, MARGIN);
    } catch {
        return "";
    }
}

/** 网关给的 `qrcode` 本身是不是一张能直接显示的图片：data URL，或带图片后缀的地址。 */
export function isQrImage(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    if (/^data:image\//i.test(text)) return true;
    return /^https?:\/\//i.test(text) && /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(text);
}

/**
 * 下单响应里的 `img`：网关已经给了图片就原样沿用；只给了二维码内容（链接）时替下游渲染成图片。
 * 两边都没有时返回空串，前台按 `qrcode` 自行渲染。
 */
export function qrImageFor(qrcode: string | undefined, img?: string | undefined): string {
    const image = (img ?? "").trim();
    if (image) return image;
    const content = (qrcode ?? "").trim();
    if (!content || isQrImage(content)) return "";
    return qrImageDataUrl(content);
}
