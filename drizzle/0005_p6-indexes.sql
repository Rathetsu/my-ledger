CREATE INDEX "occurrences_user_status_due" ON "occurrences" USING btree ("user_id","status","due_date");--> statement-breakpoint
CREATE INDEX "transactions_account_id" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_user_currency" ON "transactions" USING btree ("user_id","currency");