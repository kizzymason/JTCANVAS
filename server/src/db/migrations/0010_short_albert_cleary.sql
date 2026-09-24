ALTER TABLE "channels" ADD COLUMN "markup_percent" numeric(18, 6) DEFAULT '30' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "catalogue_revision" integer DEFAULT 0 NOT NULL;