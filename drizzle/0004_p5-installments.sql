CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"monthly_amount_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"due_day" integer NOT NULL,
	"total_count" integer NOT NULL,
	"remaining_count" integer NOT NULL,
	"start_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"apr" double precision,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;