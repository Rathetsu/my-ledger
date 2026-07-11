CREATE TABLE "flexible_debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"original_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"apr" double precision DEFAULT 0 NOT NULL,
	"deadline" date,
	"min_payment_minor" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
