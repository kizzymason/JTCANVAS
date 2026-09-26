import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/decorators";
import { ModelCatalogService } from "./model-catalog.service";

@ApiTags("models")
@Controller("models")
export class ModelCatalogController {
    constructor(private readonly catalog: ModelCatalogService) {}

    @Public()
    @Get("catalog")
    @Throttle({ default: { limit: 120, ttl: 60_000 } })
    @ApiOperation({ summary: "模型分组与介绍，供工作台模型选择弹窗使用" })
    list() {
        return this.catalog.listPublic();
    }
}
