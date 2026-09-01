import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators";
import type { AuthUser } from "../../common/types";
import { PaginationDto } from "../wallet/dto/wallet.dto";
import { CreateProjectDto, DeleteManyDto, UpdateProjectDto } from "./dto/projects.dto";
import { ProjectsService } from "./projects.service";

@ApiTags("projects")
@Controller("projects")
export class ProjectsController {
    constructor(private readonly projects: ProjectsService) {}

    @Get()
    @ApiOperation({ summary: "画布列表，不含画布数据" })
    list(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
        return this.projects.list(user.id, query);
    }

    @Get(":id")
    @ApiOperation({ summary: "读取单个画布完整数据" })
    get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
        return this.projects.get(user.id, id);
    }

    @Post()
    @ApiOperation({ summary: "新建画布" })
    create(@CurrentUser() user: AuthUser, @Body() body: CreateProjectDto) {
        return this.projects.create(user.id, body);
    }

    @Patch(":id")
    @ApiOperation({ summary: "保存画布，version 不匹配时返回 409" })
    update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: UpdateProjectDto) {
        return this.projects.update(user.id, id, body);
    }

    @Delete()
    @ApiOperation({ summary: "批量删除画布" })
    async remove(@CurrentUser() user: AuthUser, @Body() body: DeleteManyDto) {
        return { removed: await this.projects.remove(user.id, body.ids) };
    }
}
