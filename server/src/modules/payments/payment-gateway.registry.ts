import { Injectable } from "@nestjs/common";
import { noUsableChannel } from "../../common/errors";
import { EpayAdapter } from "./epay.adapter";
import { PaymentGateway, type PaymentDriver } from "./payment-gateway";

/** Maps a payment channel's driver to its adapter. Adding a gateway means adding one entry here. */
@Injectable()
export class PaymentGatewayRegistry {
    private readonly adapters: Map<PaymentDriver, PaymentGateway>;

    constructor(epay: EpayAdapter) {
        this.adapters = new Map<PaymentDriver, PaymentGateway>([["epay", epay]]);
    }

    resolve(driver: string): PaymentGateway {
        const adapter = this.adapters.get(driver as PaymentDriver);
        if (!adapter) throw noUsableChannel(`不支持的支付协议：${driver}`);
        return adapter;
    }
}
