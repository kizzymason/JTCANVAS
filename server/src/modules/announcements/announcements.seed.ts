import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/db.module";
import { announcements } from "../../db/schema";
import { JOIN_COMMUNITY_SLUG } from "./announcement-html";

export const COMMUNITY_QR_PLACEHOLDER_SRC = "/announcements/community-qr-placeholder.svg";

export const JOIN_COMMUNITY_TITLE = "加入社区";

export const JOIN_COMMUNITY_CONTENT = `<p>欢迎加入景甜画布交流群，获取使用帮助、活动通知，并和其他创作者一起交流。</p>
<p>群号：<strong>XXX</strong></p>
<p style="text-align: center"><img src="${COMMUNITY_QR_PLACEHOLDER_SRC}" alt="社群二维码占位图" width="240" style="width: 240px; max-width: 100%; height: auto"></p>
<p style="text-align: center; color: #78716c">扫描上方二维码加入（占位图，请在公告管理中替换为真实群二维码）</p>`;

export type AnnouncementSeedResult = { created: boolean; id: string };

/**
 * Ensures the join-community notice exists so the homepage button always has a target.
 * Content is not overwritten after an admin has edited or replaced the row.
 */
export async function seedJoinCommunityAnnouncement(db: Database): Promise<AnnouncementSeedResult> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('announcements.ensure-join-community'))`);
        const [existing] = await tx.select({ id: announcements.id }).from(announcements).where(eq(announcements.slug, JOIN_COMMUNITY_SLUG)).limit(1);
        if (existing) return { created: false, id: existing.id };

        const now = new Date();
        const [created] = await tx
            .insert(announcements)
            .values({
                slug: JOIN_COMMUNITY_SLUG,
                title: JOIN_COMMUNITY_TITLE,
                content: JOIN_COMMUNITY_CONTENT,
                published: true,
                pinned: true,
                sortOrder: 1,
                publishedAt: now,
            })
            .returning({ id: announcements.id });
        return { created: true, id: created.id };
    });
}
