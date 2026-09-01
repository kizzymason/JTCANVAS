import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { DeleteManyDto } from "../projects/dto/projects.dto";
import { AssetQueryDto, CreateAssetDto, UpdateAssetDto } from "./dto/assets.dto";
import { AssetsService } from "./assets.service";

@ApiTags("assets")
@Controller("assets")
export class AssetsController {
    constructor(private readonly assets: AssetsService) {}

    @Get()
    @ApiOperation({ summary: "素材列表，支持按类型与关键词筛选" })
    list(@CurrentUser() user: AuthUser, @Query() query: AssetQueryDto) {
        return this.assets.list(user.id, query);
    }

    @Get(":id")
    @ApiOperation({ summary: "读取单个素材" })
    get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        return this.assets.get(user.id, id);
    }

    @Post()
    @ApiOperation({ summary: "新增素材" })
    create(@CurrentUser() user: AuthUser, @Body() body: CreateAssetDto) {
        return this.assets.create(user.id, body);
    }

    @Patch(":id")
    @ApiOperation({ summary: "更新素材" })
    update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: UpdateAssetDto) {
        return this.assets.update(user.id, id, body);
    }

    @Delete()
    @ApiOperation({ summary: "批量删除素材" })
    async remove(@CurrentUser() user: AuthUser, @Body() body: DeleteManyDto) {
        return { removed: await this.assets.remove(user.id, body.ids) };
    }
}
