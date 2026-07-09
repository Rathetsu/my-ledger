CREATE TYPE "public"."currency" AS ENUM('EUR', 'USD', 'EGP');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('opening', 'income', 'expense', 'bill_payment', 'installment_payment', 'debt_payment', 'purchase', 'transfer_in', 'transfer_out', 'adjustment');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" "currency" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"base" text PRIMARY KEY NOT NULL,
	"rates" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"home_currency" "currency" DEFAULT 'EUR' NOT NULL,
	"essentials_baseline" jsonb,
	"ai_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"category_id" uuid,
	"occurred_on" date NOT NULL,
	"note" text,
	"one_off" boolean DEFAULT false NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"transfer_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "exchange_rates" ("base", "rates", "fetched_at")
VALUES ('USD', '{"USD":1,"EUR":0.92,"EGP":48.5}'::jsonb, '2026-01-01 00:00:00+00')
ON CONFLICT ("base") DO NOTHING;