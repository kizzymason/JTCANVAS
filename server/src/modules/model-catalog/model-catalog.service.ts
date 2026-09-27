import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { DB, type Database } from "../../db/db.module";
import { modelGroups, modelPresentations, type ModelBadge } from "../../db/schema";
import { conflict, notFound } from "../../common/errors";
import { BADGE_PRESETS, DEFAULT_MODEL_GROUPS } from "./model-catalog.seed";
import type { UpsertModelGroupDto, UpsertModelPresentationDto } from "./dto/model-catalog.dto";

export type PublicModelGroup = { id: string; key: string; name: string; description: string; sortOrder: number };
export type PublicModelPresentation = { modelValue: string; groupId: string | null; summary: string; description: string; badges: ModelBadge[]; sortOrder: number };

/**
 * 模型展示信息（分组 / 介绍 / 标识）的读写。
 * 公开侧只返回可见项，管理侧返回全量；展示信息与渠道配置相互独立，渠道换模型不会影响这里的记录。
 */
@Injectable()
export class ModelCatalogService implements OnModuleInit {
    private readonly logger = new Logger(ModelCatalogService.name);

    constructor(@Inject(DB) private readonly db: Database) {}

    async onModuleInit() {
        const created = await this.db.insert(modelGroups).values(DEFAULT_MODEL_GROUPS).onConflictDoNothing({ target: modelGroups.key }).returning({ id: modelGroups.id });
        if (created.length) this.logger.log(`默认模型分组已初始化 ${created.length} 个`);
    }

    /** 公开数据：可见分组与可见展示信息，供工作台模型选择弹窗使用。 */
    async listPublic() {
        const [groups, presentations] = await Promise.all([
            this.db.select().from(modelGroups).where(eq(modelGroups.visible, true)).orderBy(asc(modelGroups.sortOrder), asc(modelGroups.name)),
            this.db.select().from(modelPresentations).where(eq(modelPresentations.visible, true)).orderBy(asc(modelPresentations.sortOrder)),
        ]);
        return {
            groups: groups.map((row): PublicModelGroup => ({ id: row.id, key: row.key, name: row.name, description: row.description, sortOrder: row.sortOrder })),
            models: presentations.map((row): PublicModelPresentation => ({ modelValue: row.modelValue, groupId: row.groupId, summary: row.summary, description: row.description, badges: row.badges ?? [], sortOrder: row.sortOrder })),
        };
    }

    async listAdmin() {
        const [groups, presentations] = await Promise.all([
            this.db.select().from(modelGroups).orderBy(asc(modelGroups.sortOrder), asc(modelGroups.name)),
            this.db.select().from(modelPresentations).orderBy(asc(modelPresentations.sortOrder)),
        ]);
        return { groups, models: presentations, badgePresets: BADGE_PRESETS };
    }

    async createGroup(dto: UpsertModelGroupDto) {
        const [existing] = await this.db.select({ id: modelGroups.id }).from(modelGroups).where(eq(modelGroups.key, dto.key)).limit(1);
        if (existing) throw conflict("MODEL_GROUP_KEY_TAKEN", `分组标识 ${dto.key} 已被占用`);
        const [row] = await this.db.insert(modelGroups).values({
            key: dto.key,
            name: dto.name,
            description: dto.description ?? "",
            sortOrder: dto.sortOrder ?? 100,
            visible: dto.visible ?? true,
        }).returning();
        return row;
    }

    async updateGroup(id: string, dto: UpsertModelGroupDto) {
        const current = await this.findGroup(id);
        if (dto.key !== current.key) {
            const [existing] = await this.db.select({ id: modelGroups.id }).from(modelGroups).where(eq(modelGroups.key, dto.key)).limit(1);
            if (existing) throw conflict("MODEL_GROUP_KEY_TAKEN", `分组标识 ${dto.key} 已被占用`);
        }
        const [row] = await this.db.update(modelGroups).set({
            key: dto.key,
            name: dto.name,
            description: dto.description ?? current.description,
            sortOrder: dto.sortOrder ?? current.sortOrder,
            visible: dto.visible ?? current.visible,
            updatedAt: new Date(),
        }).where(eq(modelGroups.id, id)).returning();
        return row;
    }

    async removeGroup(id: string) {
        await this.findGroup(id);
        const [count] = await this.db.select({ total: sql<number>`count(*)::int` }).from(modelPresentations).where(eq(modelPresentations.groupId, id));
        await this.db.delete(modelGroups).where(eq(modelGroups.id, id));
        return { removed: true, ungrouped: count?.total ?? 0 };
    }

    async createPresentation(dto: UpsertModelPresentationDto) {
        const [existing] = await this.db.select({ id: modelPresentations.id }).from(modelPresentations).where(eq(modelPresentations.modelValue, dto.modelValue)).limit(1);
        if (existing) throw conflict("MODEL_PRESENTATION_EXISTS", "该模型已经有介绍，直接编辑即可");
        await this.assertGroup(dto.groupId);
        const [row] = await this.db.insert(modelPresentations).values({
            modelValue: dto.modelValue,
            groupId: dto.groupId ?? null,
            summary: dto.summary ?? "",
            description: dto.description ?? "",
            badges: dto.badges ?? [],
            sortOrder: dto.sortOrder ?? 100,
            visible: dto.visible ?? true,
        }).returning();
        return row;
    }

    async updatePresentation(id: string, dto: UpsertModelPresentationDto) {
        const current = await this.findPresentation(id);
        if (dto.modelValue !== current.modelValue) {
            const [existing] = await this.db.select({ id: modelPresentations.id }).from(modelPresentations).where(eq(modelPresentations.modelValue, dto.modelValue)).limit(1);
            if (existing) throw conflict("MODEL_PRESENTATION_EXISTS", `模型 ${dto.modelValue} 已经有介绍`);
        }
        await this.assertGroup(dto.groupId);
        const [row] = await this.db.update(modelPresentations).set({
            modelValue: dto.modelValue,
            groupId: dto.groupId === undefined ? current.groupId : dto.groupId,
            summary: dto.summary ?? current.summary,
            description: dto.description ?? current.description,
            badges: dto.badges ?? current.badges,
            sortOrder: dto.sortOrder ?? current.sortOrder,
            visible: dto.visible ?? current.visible,
            updatedAt: new Date(),
        }).where(eq(modelPresentations.id, id)).returning();
        return row;
    }

    async removePresentation(id: string) {
        await this.findPresentation(id);
        await this.db.delete(modelPresentations).where(eq(modelPresentations.id, id));
        return { removed: true };
    }

    private async findGroup(id: string) {
        const [row] = await this.db.select().from(modelGroups).where(eq(modelGroups.id, id)).limit(1);
        if (!row) throw notFound("分组不存在");
        return row;
    }

    private async findPresentation(id: string) {
        const [row] = await this.db.select().from(modelPresentations).where(eq(modelPresentations.id, id)).limit(1);
        if (!row) throw notFound("模型介绍不存在");
        return row;
    }

    private async assertGroup(groupId?: string | null) {
        if (!groupId) return;
        const [row] = await this.db.select({ id: modelGroups.id }).from(modelGroups).where(eq(modelGroups.id, groupId)).limit(1);
        if (!row) throw notFound("所选分组不存在");
    }
}
