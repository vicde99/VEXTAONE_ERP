-- Accounting core foundation. Existing journal rows, if any, remain drafts until explicitly reviewed.
ALTER TABLE "journal_entries"
  ADD COLUMN "period_id" UUID,
  ADD COLUMN "journal_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "reversal_of_id" UUID,
  ADD COLUMN "posted_by_user_id" UUID,
  ADD COLUMN "posted_at" TIMESTAMPTZ;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "journal_entries_reversal_of_id_fkey"
    FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "journal_entries_posted_by_user_id_fkey"
    FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "journal_entries_company_id_source_module_source_document_id_key"
  ON "journal_entries"("company_id", "source_module", "source_document_id");
CREATE INDEX "journal_entries_company_id_journal_date_status_idx"
  ON "journal_entries"("company_id", "journal_date", "status");
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

ALTER TABLE "journal_lines"
  ALTER COLUMN "debit_amount" SET DEFAULT 0,
  ALTER COLUMN "credit_amount" SET DEFAULT 0;

CREATE OR REPLACE FUNCTION "guard_posted_journal_entry"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  line_count BIGINT;
  debit_total NUMERIC(18,2);
  credit_total NUMERIC(18,2);
  period_status TEXT;
  period_start DATE;
  period_end DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'Posted journal entries are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable';
  END IF;

  IF NEW."status" = 'POSTED' THEN
    IF NEW."period_id" IS NULL OR NEW."posted_by_user_id" IS NULL OR NEW."posted_at" IS NULL THEN
      RAISE EXCEPTION 'Posting requires an accounting period, posting user, and posting timestamp';
    END IF;

    SELECT "status", "starts_on", "ends_on"
      INTO period_status, period_start, period_end
      FROM "accounting_periods" WHERE "id" = NEW."period_id";
    IF NOT FOUND OR period_status <> 'OPEN' THEN
      RAISE EXCEPTION 'Accounting period does not exist or is not open';
    END IF;
    IF NEW."journal_date" < period_start OR NEW."journal_date" > period_end THEN
      RAISE EXCEPTION 'Journal date must be within its accounting period';
    END IF;

    SELECT COUNT(*), COALESCE(SUM("debit_amount"), 0), COALESCE(SUM("credit_amount"), 0)
      INTO line_count, debit_total, credit_total
      FROM "journal_lines" WHERE "journal_entry_id" = NEW."id";
    IF line_count < 2 OR debit_total <= 0 OR debit_total <> credit_total THEN
      RAISE EXCEPTION 'Journal entry must contain at least two lines and balance exactly';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_entries_posting_guard"
BEFORE UPDATE OR DELETE ON "journal_entries"
FOR EACH ROW EXECUTE FUNCTION "guard_posted_journal_entry"();

CREATE OR REPLACE FUNCTION "guard_posted_journal_line"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entry_status TEXT;
  entry_id UUID;
BEGIN
  entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."journal_entry_id" ELSE NEW."journal_entry_id" END;
  SELECT "status" INTO entry_status FROM "journal_entries" WHERE "id" = entry_id;
  IF entry_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted journal entry are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_lines_posting_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
FOR EACH ROW EXECUTE FUNCTION "guard_posted_journal_line"();
