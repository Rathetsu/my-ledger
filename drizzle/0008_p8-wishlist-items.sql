CREATE TYPE "public"."wishlist_status" AS ENUM('planned', 'purchased');--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"cost_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"target_date" date,
	"status" "wishlist_status" DEFAULT 'planned' NOT NULL,
	"transaction_id" uuid
);
