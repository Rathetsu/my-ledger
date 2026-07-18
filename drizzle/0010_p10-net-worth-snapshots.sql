CREATE TABLE "net_worth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"per_currency" jsonb NOT NULL,
	"combined_minor" bigint NOT NULL,
	"home_currency" "currency" NOT NULL,
	"rates" jsonb NOT NULL,
	"total_debt_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "net_worth_snapshots_user_date" ON "net_worth_snapshots" USING btree ("user_id","date");