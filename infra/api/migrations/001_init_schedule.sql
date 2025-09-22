-- DEVATA initial schema for scheduling, bookings, and payments
-- Covers roadmap stages 2-3: slot generation, bookings with partial prepayment, and 26/74 ledger support

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE booking_status AS ENUM ('reserved', 'pending', 'confirmed', 'completed', 'canceled', 'expired', 'no_show');
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'cancelled', 'failed', 'refunded');
CREATE TYPE payment_kind AS ENUM ('deposit', 'balance', 'full', 'refund', 'adjustment');
CREATE TYPE schedule_rule_kind AS ENUM ('weekly', 'one_off');
CREATE TYPE schedule_exception_kind AS ENUM ('closed', 'extended');

CREATE TABLE centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  address TEXT,
  phone TEXT,
  email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'RUB',
  payment_policy TEXT NOT NULL,
  deposit_percent INTEGER NOT NULL DEFAULT 0 CHECK (deposit_percent BETWEEN 0 AND 100),
  deposit_deadline_minutes INTEGER CHECK (deposit_deadline_minutes >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE center_services (
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (center_id, service_id)
);

CREATE TABLE specialists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  display_name TEXT NOT NULL,
  bio TEXT,
  phone TEXT,
  email TEXT,
  default_center_id UUID REFERENCES centers(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE specialist_services (
  specialist_id UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  payout_percent NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (specialist_id, service_id, center_id)
);

CREATE TABLE schedule_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specialist_id UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  kind schedule_rule_kind NOT NULL DEFAULT 'weekly',
  weekday SMALLINT CHECK (weekday BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  slot_duration_minutes INTEGER NOT NULL CHECK (slot_duration_minutes > 0),
  CHECK (starts_at < ends_at),
  valid_from DATE NOT NULL,
  valid_to DATE,
  capacity SMALLINT NOT NULL DEFAULT 1 CHECK (capacity > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specialist_id UUID NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  kind schedule_exception_kind NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity SMALLINT CHECK (capacity >= 0),
  CHECK (starts_at < ends_at),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL UNIQUE,
  center_id UUID NOT NULL REFERENCES centers(id),
  service_id UUID NOT NULL REFERENCES services(id),
  specialist_id UUID NOT NULL REFERENCES specialists(id),
  slot_start TIMESTAMPTZ NOT NULL,
  slot_end TIMESTAMPTZ NOT NULL,
  CHECK (slot_start < slot_end),
  status booking_status NOT NULL,
  source TEXT,
  ref_id TEXT,
  hold_expires_at TIMESTAMPTZ,
  deposit_due_at TIMESTAMPTZ,
  deposit_amount_cents INTEGER CHECK (deposit_amount_cents >= 0),
  total_amount_cents INTEGER CHECK (total_amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'RUB',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT
);

CREATE UNIQUE INDEX bookings_active_slot_unique
  ON bookings (specialist_id, slot_start, slot_end)
  WHERE status IN ('reserved', 'pending', 'confirmed');

CREATE TABLE booking_clients (
  booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  comment TEXT,
  consented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE booking_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status booking_status NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE INDEX booking_status_history_idx ON booking_status_history (booking_id, changed_at DESC);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'RUB',
  deposit_percent INTEGER CHECK (deposit_percent BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  kind payment_kind NOT NULL,
  status payment_status NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'RUB',
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payments_provider_unique ON payments (provider, provider_payment_id);
CREATE INDEX payments_order_idx ON payments (order_id, occurred_at DESC);

CREATE TABLE funds_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  level SMALLINT,
  basis_points INTEGER NOT NULL CHECK (basis_points >= 0 AND basis_points <= 10000),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX funds_ledger_payment_idx ON funds_ledger_entries (payment_id);
