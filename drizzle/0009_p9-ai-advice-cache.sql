CREATE TABLE "ai_advice_cache" (
	"user_id" text PRIMARY KEY NOT NULL,
	"payload_hash" text NOT NULL,
	"advice" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
