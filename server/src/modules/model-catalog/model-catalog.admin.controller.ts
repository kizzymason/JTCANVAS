import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminOnly, Audit } from "../../common/decorators";
import { UpsertModelGroupDto, UpsertModelPresentationDto } from "./dto/model-catalog.dto";
import { ModelCatalogService } from "./model-catalog.service";

@ApiTags("admin")
@AdminOnly()
@Controller("admin/model-catalog")
export class ModelCatalogAdminController {
    constructor(private readonly catalog: ModelCatalogService) {}

    @Get()
    @ApiOperation({ summary: "模型分组与介绍（管理端，含隐藏项）" })
    list() {
        return this.catalog.listAdmin();
    }

    @Post("groups")
    @Audit({ action: "modelCatalog.group.create", targetType: "model_group" })
    @ApiOperation({ summary: "新增模型分组" })
    createGroup(@Body() body: UpsertModelGroupDto) {
        return this.catalog.createGroup(body);
    }

    @Patch("groups/:id")
    @Audit({ action: "modelCatalog.group.update", targetType: "model_group" })
    @ApiOperation({ summary: "修改模型分组" })
    updateGroup(@Param("id") id: string, @Body() body: UpsertModelGroupDto) {
        return this.catalog.updateGroup(id, body);
    }

    @Delete("groups/:id")
    @Audit({ action: "modelCatalog.group.delete", targetType: "model_group" })
    @ApiOperation({ summary: "删除模型分组，组内模型会变成未分组" })
    removeGroup(@Param("id") id: string) {
        return this.catalog.removeGroup(id);
    }

    @Post("presentations")
    @Audit({ action: "modelCatalog.presentation.create", targetType: "model_presentation" })
    @ApiOperation({ summary: "为某个模型新增介绍与标识" })
    createPresentation(@Body() body: UpsertModelPresentationDto) {
        return this.catalog.createPresentation(body);
    }

    @Patch("presentations/:id")
    @Audit({ action: "modelCatalog.presentation.update", targetType: "model_presentation" })
    @ApiOperation({ summary: "修改模型介绍与标识" })
    updatePresentation(@Param("id") id: string, @Body() body: UpsertModelPresentationDto) {
        return this.catalog.updatePresentation(id, body);
    }

    @Delete("presentations/:id")
    @Audit({ action: "modelCatalog.presentation.delete", targetType: "model_presentation" })
    @ApiOperation({ summary: "删除模型介绍" })
    removePresentation(@Param("id") id: string) {
        return this.catalog.removePresentation(id);
    }
}
