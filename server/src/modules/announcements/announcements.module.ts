import { Module } from "@nestjs/common";
import { AdminAnnouncementsController } from "./announcements.admin.controller";
import { AnnouncementsController } from "./announcements.controller";
import { AnnouncementsService } from "./announcements.service";

@Module({
    controllers: [AnnouncementsController, AdminAnnouncementsController],
    providers: [AnnouncementsService],
    exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
