import { Module } from "@nestjs/common";
import { ModelCatalogAdminController } from "./model-catalog.admin.controller";
import { ModelCatalogController } from "./model-catalog.controller";
import { ModelCatalogService } from "./model-catalog.service";

@Module({
    controllers: [ModelCatalogController, ModelCatalogAdminController],
    providers: [ModelCatalogService],
    exports: [ModelCatalogService],
})
export class ModelCatalogModule {}
