-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('VIRTUAL', 'SINGLE_USE');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('ACTIVE', 'FROZEN', 'TERMINATED', 'USED');

-- CreateEnum
CREATE TYPE "CardBrand" AS ENUM ('VISA', 'MASTERCARD');

-- CreateEnum
CREATE TYPE "CardAuthStatus" AS ENUM ('AUTHORIZED', 'PARTIALLY_CAPTURED', 'CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED', 'EXPIRED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CardEventKind" AS ENUM ('CAPTURE', 'RELEASE', 'REFUND');

-- CreateEnum
CREATE TYPE "CardChannel" AS ENUM ('ECOMMERCE', 'POS');

-- CreateEnum
CREATE TYPE "BillerCategory" AS ENUM ('ELECTRICITY', 'GAS', 'WATER', 'INTERNET', 'MOBILE', 'TV', 'EDUCATION', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('PROCESSING', 'PAID', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BillAmountMode" AS ENUM ('FULL_DUE', 'FIXED');

-- CreateEnum
CREATE TYPE "BillFrequency" AS ENUM ('ONCE', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "BillScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FraudAction" AS ENUM ('ALLOW', 'CHALLENGE', 'BLOCK');

-- CreateEnum
CREATE TYPE "FraudChannel" AS ENUM ('P2P', 'QR', 'REQUEST', 'CARD', 'BILL');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "FraudCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED_FRAUD', 'CLOSED_LEGIT');

-- CreateEnum
CREATE TYPE "StepUpStatus" AS ENUM ('PENDING', 'PASSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FreezeReasonCode" AS ENUM ('FRAUD_SUSPECTED', 'FRAUD_CONFIRMED', 'SANCTIONS_HIT', 'AML_REVIEW', 'COURT_ORDER', 'CUSTOMER_REQUEST', 'KYC_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "AmlFlagType" AS ENUM ('STRUCTURING', 'MULE_PATTERN', 'HIGH_VELOCITY', 'SANCTIONS_MATCH', 'FRAUD_BLOCK');

-- CreateEnum
CREATE TYPE "AmlFlagStatus" AS ENUM ('OPEN', 'CLEARED', 'ESCALATED');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'STEP_UP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryType" ADD VALUE 'CARD_AUTH_HOLD';
ALTER TYPE "EntryType" ADD VALUE 'CARD_CAPTURE';
ALTER TYPE "EntryType" ADD VALUE 'CARD_HOLD_RELEASE';
ALTER TYPE "EntryType" ADD VALUE 'CARD_REFUND';
ALTER TYPE "EntryType" ADD VALUE 'BILL_PAYMENT';

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "type" "CardType" NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT NOT NULL,
    "brand" "CardBrand" NOT NULL,
    "last4" TEXT NOT NULL,
    "pan_fingerprint" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "pan_ciphertext" TEXT NOT NULL,
    "cvv_ciphertext" TEXT NOT NULL,
    "wrapped_data_key" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "expiry_month" INTEGER NOT NULL,
    "expiry_year" INTEGER NOT NULL,
    "cardholder_name" TEXT NOT NULL,
    "per_txn_limit" BIGINT NOT NULL,
    "daily_limit" BIGINT NOT NULL,
    "monthly_limit" BIGINT NOT NULL,
    "ecommerce_enabled" BOOLEAN NOT NULL DEFAULT true,
    "international_enabled" BOOLEAN NOT NULL DEFAULT false,
    "amount_cap" BIGINT,
    "external_ref" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_authorizations" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "network_ref" TEXT NOT NULL,
    "merchant_name" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "merchant_country" TEXT NOT NULL,
    "channel" "CardChannel" NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "captured_amount" BIGINT NOT NULL DEFAULT 0,
    "released_amount" BIGINT NOT NULL DEFAULT 0,
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "original_currency" "Currency",
    "original_amount" BIGINT,
    "status" "CardAuthStatus" NOT NULL,
    "decline_code" TEXT,
    "decline_reason" TEXT,
    "hold_entry_id" UUID,
    "fraud_decision_id" UUID,
    "expires_at" TIMESTAMP(3),
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_auth_events" (
    "id" UUID NOT NULL,
    "authorization_id" UUID NOT NULL,
    "kind" "CardEventKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "network_ref" TEXT NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_reveal_logs" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "ip_address" TEXT,
    "hide_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_reveal_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "category" "BillerCategory" NOT NULL,
    "currency" "Currency" NOT NULL,
    "country" TEXT NOT NULL,
    "reference_label" TEXT NOT NULL,
    "reference_pattern" TEXT NOT NULL,
    "supports_inquiry" BOOLEAN NOT NULL DEFAULT true,
    "allows_partial_payment" BOOLEAN NOT NULL DEFAULT false,
    "fee_fixed" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_inquiries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "biller_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount_due" BIGINT NOT NULL,
    "amount_after_due" BIGINT,
    "due_date" TIMESTAMP(3) NOT NULL,
    "bill_status" TEXT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "biller_id" UUID NOT NULL,
    "inquiry_id" UUID,
    "schedule_id" UUID,
    "reference" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'PROCESSING',
    "receipt_number" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "failure_details" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "journal_entry_id" UUID,
    "reversal_entry_id" UUID,
    "fraud_decision_id" UUID,
    "external_ref" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "biller_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "nickname" TEXT,
    "amount_mode" "BillAmountMode" NOT NULL,
    "fixed_amount" BIGINT,
    "frequency" "BillFrequency" NOT NULL,
    "anchor_day" INTEGER NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" "BillScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_run_at" TIMESTAMP(3),
    "last_run_status" TEXT,
    "last_payment_id" UUID,
    "external_ref" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_biller_payments" (
    "id" UUID NOT NULL,
    "biller_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "billing_month" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "our_reference" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_biller_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_rules" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_rules_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fraud_policies" (
    "id" TEXT NOT NULL,
    "challenge_threshold" INTEGER NOT NULL,
    "block_threshold" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_decisions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "FraudChannel" NOT NULL,
    "action" "FraudAction" NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "currency" "Currency",
    "amount" BIGINT,
    "subject_ref" TEXT NOT NULL,
    "step_up_passed" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "status" "StepUpStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "passed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_cases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "status" "FraudCaseStatus" NOT NULL DEFAULT 'OPEN',
    "rule_code" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "currency" "Currency",
    "amount" BIGINT,
    "related_payment_ids" JSONB NOT NULL DEFAULT '[]',
    "decision_id" UUID,
    "assignee_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_notes" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_freezes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason_code" "FreezeReasonCode" NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "frozen_wallet_ids" JSONB NOT NULL DEFAULT '[]',
    "lifted_at" TIMESTAMP(3),
    "lifted_by_id" UUID,
    "lift_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_flags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "AmlFlagType" NOT NULL,
    "status" "AmlFlagStatus" NOT NULL DEFAULT 'OPEN',
    "dedupe_key" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "subject_ref" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aml_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions_entries" (
    "id" UUID NOT NULL,
    "list_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cards_pan_fingerprint_key" ON "cards"("pan_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "cards_token_key" ON "cards"("token");

-- CreateIndex
CREATE UNIQUE INDEX "cards_external_ref_key" ON "cards"("external_ref");

-- CreateIndex
CREATE INDEX "cards_user_id_created_at_idx" ON "cards"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "card_authorizations_network_ref_key" ON "card_authorizations"("network_ref");

-- CreateIndex
CREATE UNIQUE INDEX "card_authorizations_hold_entry_id_key" ON "card_authorizations"("hold_entry_id");

-- CreateIndex
CREATE INDEX "card_authorizations_card_id_created_at_idx" ON "card_authorizations"("card_id", "created_at");

-- CreateIndex
CREATE INDEX "card_authorizations_status_expires_at_idx" ON "card_authorizations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "card_auth_events_network_ref_key" ON "card_auth_events"("network_ref");

-- CreateIndex
CREATE UNIQUE INDEX "card_auth_events_journal_entry_id_key" ON "card_auth_events"("journal_entry_id");

-- CreateIndex
CREATE INDEX "card_auth_events_authorization_id_created_at_idx" ON "card_auth_events"("authorization_id", "created_at");

-- CreateIndex
CREATE INDEX "card_reveal_logs_card_id_created_at_idx" ON "card_reveal_logs"("card_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billers_code_key" ON "billers"("code");

-- CreateIndex
CREATE INDEX "billers_category_idx" ON "billers"("category");

-- CreateIndex
CREATE INDEX "bill_inquiries_user_id_created_at_idx" ON "bill_inquiries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_journal_entry_id_key" ON "bill_payments"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_reversal_entry_id_key" ON "bill_payments"("reversal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_external_ref_key" ON "bill_payments"("external_ref");

-- CreateIndex
CREATE INDEX "bill_payments_user_id_created_at_idx" ON "bill_payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bill_payments_status_next_attempt_at_idx" ON "bill_payments"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "bill_payments_biller_id_reference_billing_month_idx" ON "bill_payments"("biller_id", "reference", "billing_month");

-- CreateIndex
CREATE UNIQUE INDEX "bill_schedules_external_ref_key" ON "bill_schedules"("external_ref");

-- CreateIndex
CREATE INDEX "bill_schedules_user_id_created_at_idx" ON "bill_schedules"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bill_schedules_status_next_run_at_idx" ON "bill_schedules"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "sim_biller_payments_our_reference_key" ON "sim_biller_payments"("our_reference");

-- CreateIndex
CREATE UNIQUE INDEX "sim_biller_payments_receipt_number_key" ON "sim_biller_payments"("receipt_number");

-- CreateIndex
CREATE INDEX "sim_biller_payments_biller_id_reference_billing_month_idx" ON "sim_biller_payments"("biller_id", "reference", "billing_month");

-- CreateIndex
CREATE INDEX "fraud_decisions_user_id_created_at_idx" ON "fraud_decisions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_decisions_subject_ref_idx" ON "fraud_decisions"("subject_ref");

-- CreateIndex
CREATE INDEX "step_up_challenges_user_id_subject_ref_idx" ON "step_up_challenges"("user_id", "subject_ref");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_cases_decision_id_key" ON "fraud_cases"("decision_id");

-- CreateIndex
CREATE INDEX "fraud_cases_status_severity_created_at_idx" ON "fraud_cases"("status", "severity", "created_at");

-- CreateIndex
CREATE INDEX "fraud_cases_user_id_created_at_idx" ON "fraud_cases"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_notes_case_id_created_at_idx" ON "fraud_case_notes"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "account_freezes_user_id_created_at_idx" ON "account_freezes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "aml_flags_dedupe_key_key" ON "aml_flags"("dedupe_key");

-- CreateIndex
CREATE INDEX "aml_flags_status_created_at_idx" ON "aml_flags"("status", "created_at");

-- CreateIndex
CREATE INDEX "aml_flags_user_id_created_at_idx" ON "aml_flags"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "sanctions_entries_normalized_name_idx" ON "sanctions_entries"("normalized_name");

-- AddForeignKey
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_authorizations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_auth_events" ADD CONSTRAINT "card_auth_events_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "card_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_notes" ADD CONSTRAINT "fraud_case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "fraud_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Integrity: CHECK constraints ─────────────
ALTER TABLE "cards" ADD CONSTRAINT "cards_limits_valid"
  CHECK ("per_txn_limit" > 0 AND "per_txn_limit" <= "daily_limit" AND "daily_limit" <= "monthly_limit"
         AND ("amount_cap" IS NULL OR "amount_cap" > 0) AND "last4" ~ '^[0-9]{4}$'
         AND "expiry_month" BETWEEN 1 AND 12);
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_auth_amounts_valid"
  CHECK ("amount" > 0 AND "captured_amount" >= 0 AND "released_amount" >= 0 AND "refunded_amount" >= 0
         AND "captured_amount" + "released_amount" <= "amount"
         AND "refunded_amount" <= "captured_amount");
ALTER TABLE "card_auth_events" ADD CONSTRAINT "card_auth_events_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_amounts_valid" CHECK ("amount" > 0 AND "fee" >= 0);
ALTER TABLE "bill_schedules" ADD CONSTRAINT "bill_schedules_amount_valid"
  CHECK (("amount_mode" = 'FIXED' AND "fixed_amount" > 0) OR ("amount_mode" = 'FULL_DUE'));
ALTER TABLE "fraud_decisions" ADD CONSTRAINT "fraud_decisions_score_range" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "fraud_cases" ADD CONSTRAINT "fraud_cases_score_range" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "fraud_policies" ADD CONSTRAINT "fraud_policies_thresholds_valid"
  CHECK ("challenge_threshold" BETWEEN 1 AND 100 AND "block_threshold" BETWEEN 1 AND 100
         AND "challenge_threshold" <= "block_threshold");
ALTER TABLE "fraud_rules" ADD CONSTRAINT "fraud_rules_weight_range" CHECK ("weight" BETWEEN 0 AND 100);

-- At most one active (not lifted) freeze per user.
CREATE UNIQUE INDEX "account_freezes_one_active" ON "account_freezes" ("user_id") WHERE "lifted_at" IS NULL;

-- Audit-style history is append-only once written.
CREATE TRIGGER card_auth_events_append_only
  BEFORE UPDATE OR DELETE ON "card_auth_events"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();
CREATE TRIGGER card_reveal_logs_append_only
  BEFORE UPDATE OR DELETE ON "card_reveal_logs"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();
CREATE TRIGGER fraud_decisions_append_only
  BEFORE UPDATE OR DELETE ON "fraud_decisions"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();

-- ───────────── Supabase lockdown: RLS on every new table (no policies) ─────────────
ALTER TABLE "cards"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_auth_events"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_reveal_logs"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billers"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_inquiries"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_payments"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_schedules"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sim_biller_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_rules"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_policies"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_decisions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "step_up_challenges"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_cases"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_case_notes"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_freezes"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aml_flags"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sanctions_entries"   ENABLE ROW LEVEL SECURITY;
