import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { EstimateDto, ModelsQueryDto } from "./dto/pricing.dto";
import { PricingService } from "./pricing.service";

@ApiTags("models")
@Controller()
export class PricingController {
    constructor(private readonly pricing: PricingService) {}

    @Get("models")
    @ApiOperation({ summary: "可用模型与价格表，前端据此渲染选择器并本地计算预估价" })
    async models(@Query() query: ModelsQueryDto) {
        const models = query.capability ? await this.pricing.listByCapability(query.capability) : await this.pricing.listPublicModels();
        return { models };
    }

    @Post("estimate")
    @HttpCode(200)
    @ApiOperation({ summary: "服务端权威估价" })
    estimate(@Body() body: EstimateDto) {
        return this.pricing.estimate(body);
    }
}
