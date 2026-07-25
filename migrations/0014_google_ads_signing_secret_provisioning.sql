-- Google Ads Manager Script one-time Signing Secret provisioning tickets.
-- Additive only: stores fingerprints/non-secret binding and does not enable ingress or Business writes.

CREATE TABLE IF NOT EXISTS google_ads_signing_provisioning_tickets (
  ticket_fingerprint TEXT PRIMARY KEY
    CHECK (
      length(ticket_fingerprint) = 43
      AND ticket_fingerprint NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  identity_fingerprint TEXT NOT NULL
    CHECK (
      length(identity_fingerprint) = 64
      AND identity_fingerprint NOT GLOB '*[^a-f0-9]*'
    ),
  key_id TEXT NOT NULL
    CHECK (
      length(key_id) BETWEEN 1 AND 64
      AND key_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('active', 'redeemed', 'confirmed', 'expired', 'cancelled')),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      expires_at > created_at
      AND expires_at <= created_at + 300000
    ),
  redeemed_at INTEGER,
  confirmed_at INTEGER,
  challenge_fingerprint TEXT
    CHECK (
      challenge_fingerprint IS NULL
      OR (
        length(challenge_fingerprint) = 43
        AND challenge_fingerprint NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  CHECK (
    (status IN ('active', 'cancelled')
      AND redeemed_at IS NULL
      AND confirmed_at IS NULL
      AND challenge_fingerprint IS NULL)
    OR
    (status = 'expired'
      AND confirmed_at IS NULL
      AND (
        (redeemed_at IS NULL AND challenge_fingerprint IS NULL)
        OR
        (redeemed_at IS NOT NULL AND challenge_fingerprint IS NOT NULL)
      ))
    OR
    (status = 'redeemed'
      AND redeemed_at IS NOT NULL
      AND confirmed_at IS NULL
      AND challenge_fingerprint IS NOT NULL)
    OR
    (status = 'confirmed'
      AND redeemed_at IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_at >= redeemed_at
      AND challenge_fingerprint IS NOT NULL)
  ),
  CHECK (redeemed_at IS NULL OR (redeemed_at >= created_at AND redeemed_at <= expires_at)),
  CHECK (confirmed_at IS NULL OR (confirmed_at >= created_at AND confirmed_at <= expires_at))
);

CREATE INDEX IF NOT EXISTS idx_google_ads_signing_provisioning_status_expiry
ON google_ads_signing_provisioning_tickets(status, expires_at);
