CREATE TYPE "public"."occurrence_kind" AS ENUM('income', 'bill', 'installment');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('pending', 'confirmed', 'skipped', 'overdue');--> statement-breakpoint
CREATE TABLE "income_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"day_of_month" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"recurring" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "occurrence_kind" NOT NULL,
	"source_id" uuid NOT NULL,
	"period" text NOT NULL,
	"due_date" date NOT NULL,
	"expected_amount_minor" integer NOT NULL,
	"status" "occurrence_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid
);
--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_user_kind_source_period" ON "occurrences" USING btree ("user_id","kind","source_id","period");