ALTER TYPE "public"."data_source" ADD VALUE 'SAP_SANDBOX';--> statement-breakpoint
ALTER TYPE "public"."sap_adapter" ADD VALUE 'sap_api_sandbox';--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sap_credentials" (
	"sap_system_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sap_systems" ADD COLUMN "last_check" jsonb;--> statement-breakpoint
ALTER TABLE "sap_systems" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sap_tool_calls" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "sap_tool_calls" ADD COLUMN "api_token_id" uuid;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_credentials" ADD CONSTRAINT "sap_credentials_sap_system_id_sap_systems_id_fk" FOREIGN KEY ("sap_system_id") REFERENCES "public"."sap_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_credentials" ADD CONSTRAINT "sap_credentials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_unique" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_project_idx" ON "api_tokens" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "sap_tool_calls" ADD CONSTRAINT "sap_tool_calls_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_tool_calls" ADD CONSTRAINT "sap_tool_calls_api_token_id_api_tokens_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sap_tool_calls_project_idx" ON "sap_tool_calls" USING btree ("project_id","created_at");