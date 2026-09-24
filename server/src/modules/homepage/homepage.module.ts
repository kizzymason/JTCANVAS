import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AdminHomepageController, HomepageController } from "./homepage.controller";
import { HomepageService } from "./homepage.service";

@Module({ imports: [StorageModule], controllers: [HomepageController, AdminHomepageController], providers: [HomepageService] })
export class HomepageModule {}
