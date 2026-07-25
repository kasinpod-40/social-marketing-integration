import {
  GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS,
  GOOGLE_ADS_SIGNING_PROVISIONING_STATUSES,
} from '../../../config/src/google-ads-signing-secret-provisioning-contract.js';
import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

/** D1 authority for fingerprint-only one-time provisioning capabilities. */
export class D1GoogleAdsSigningSecretProvisioningStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  /** Local/operator-only primitive; there is intentionally no HTTP ticket-creation route. */
  async createTicket(input = {}) {
    const row = normalizeNewTicket(input, this.now());
    let result;
    try {
      result = await this.db.prepare(`
        INSERT INTO google_ads_signing_provisioning_tickets (
          ticket_fingerprint, identity_fingerprint, key_id, status,
          created_at, expires_at, redeemed_at, confirmed_at,
          challenge_fingerprint
        ) VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL, NULL)
        ON CONFLICT(ticket_fingerprint) DO NOTHING
      `).bind(
        row.ticketFingerprint,
        row.identityFingerprint,
        row.keyId,
        row.createdAt,
        row.expiresAt,
      ).run();
    } catch (cause) {
      throw unavailable(
        'Google Ads provisioning ticket creation failed',
        'GOOGLE_ADS_PROVISIONING_D1_TICKET_CREATE_FAILED',
        cause,
      );
    }
    if (changes(result) !== 1) {
      throw permanentError('Google Ads provisioning ticket already exists', {
        code: 'GOOGLE_ADS_PROVISIONING_TICKET_CONFLICT',
      });
    }
    return this.getTicket(row.ticketFingerprint);
  }

  /** Atomic single redeem. A consumed capability is never reset to active. */
  async redeemTicket(input = {}) {
    const row = normalizeRedeem(input, this.now());
    await this.expireTicket(row.ticketFingerprint, row.now);
    let result;
    try {
      result = await this.db.prepare(`
        UPDATE google_ads_signing_provisioning_tickets
        SET status = 'redeemed',
            redeemed_at = ?,
            challenge_fingerprint = ?
        WHERE ticket_fingerprint = ?
          AND identity_fingerprint = ?
          AND key_id = ?
          AND status = 'active'
          AND expires_at >= ?
      `).bind(
        row.now,
        row.challengeFingerprint,
        row.ticketFingerprint,
        row.identityFingerprint,
        row.keyId,
        row.now,
      ).run();
    } catch (cause) {
      throw unavailable(
        'Google Ads provisioning ticket redeem failed',
        'GOOGLE_ADS_PROVISIONING_D1_TICKET_REDEEM_FAILED',
        cause,
      );
    }
    const ticket = await this.getTicket(row.ticketFingerprint);
    if (changes(result) !== 1) throw classifyUnusable(ticket, row);
    return assertTicketBinding(ticket, row, ['redeemed']);
  }

  /** Read only a redeemed/confirmed capability after exact binding checks. */
  async readTicketForConfirmation(input = {}) {
    const row = normalizeConfirmation(input, this.now());
    await this.expireTicket(row.ticketFingerprint, row.now);
    const ticket = await this.getTicket(row.ticketFingerprint);
    return assertTicketBinding(ticket, row, ['redeemed', 'confirmed']);
  }

  /** Atomic redeemed -> confirmed. Exact confirmation replay is idempotent within Ticket TTL. */
  async confirmTicket(input = {}) {
    const row = normalizeConfirmation(input, this.now());
    let result;
    try {
      result = await this.db.prepare(`
        UPDATE google_ads_signing_provisioning_tickets
        SET status = 'confirmed',
            confirmed_at = COALESCE(confirmed_at, ?)
        WHERE ticket_fingerprint = ?
          AND identity_fingerprint = ?
          AND key_id = ?
          AND challenge_fingerprint = ?
          AND status = 'redeemed'
          AND expires_at >= ?
      `).bind(
        row.now,
        row.ticketFingerprint,
        row.identityFingerprint,
        row.keyId,
        row.challengeFingerprint,
        row.now,
      ).run();
    } catch (cause) {
      throw unavailable(
        'Google Ads provisioning confirmation write failed',
        'GOOGLE_ADS_PROVISIONING_D1_CONFIRM_FAILED',
        cause,
      );
    }
    const ticket = await this.getTicket(row.ticketFingerprint);
    if (changes(result) === 1) {
      return Object.freeze({
        disposition: 'confirmed',
        ticket: assertTicketBinding(ticket, row, ['confirmed']),
      });
    }
    const exact = assertTicketBinding(ticket, row, ['confirmed']);
    return Object.freeze({ disposition: 'exact_retry', ticket: exact });
  }

  async cancelTicket(input = {}) {
    const ticketFingerprint = fingerprint43(input.ticketFingerprint, 'ticketFingerprint');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.prepare(`
        UPDATE google_ads_signing_provisioning_tickets
        SET status = 'cancelled'
        WHERE ticket_fingerprint = ?
          AND status = 'active'
          AND expires_at >= ?
      `).bind(ticketFingerprint, now).run();
    } catch (cause) {
      throw unavailable(
        'Google Ads provisioning cancellation failed',
        'GOOGLE_ADS_PROVISIONING_D1_CANCEL_FAILED',
        cause,
      );
    }
    return this.getTicket(ticketFingerprint);
  }

  async getTicket(ticketFingerprint) {
    let row;
    try {
      row = await this.db.prepare(`
        SELECT *
        FROM google_ads_signing_provisioning_tickets
        WHERE ticket_fingerprint = ?
      `).bind(fingerprint43(ticketFingerprint, 'ticketFingerprint')).first();
    } catch (cause) {
      throw unavailable(
        'Google Ads provisioning ticket read failed',
        'GOOGLE_ADS_PROVISIONING_D1_TICKET_READ_FAILED',
        cause,
      );
    }
    return row ? mapTicket(row) : null;
  }

  async expireTicket(ticketFingerprint, now) {
    try {
      await this.db.prepare(`
        UPDATE google_ads_signing_provisioning_tickets
        SET status = 'expired'
        WHERE ticket_fingerprint = ?
          AND status IN ('active', 'redeemed')
          AND expires_at < ?
      `).bind(
        fingerprint43(ticketFingerprint, 'ticketFingerprint'),
        timestamp(now, 'now'),
      ).run();
    } catch (cause) {
      throw unavailable(
        'Google Ads provisioning ticket expiry failed',
        'GOOGLE_ADS_PROVISIONING_D1_TICKET_EXPIRE_FAILED',
        cause,
      );
    }
  }
}

function normalizeNewTicket(input, defaultNow) {
  const createdAt = timestamp(input.createdAt ?? input.now ?? defaultNow, 'createdAt');
  const expiresAt = timestamp(input.expiresAt, 'expiresAt');
  if (
    expiresAt <= createdAt
    || expiresAt > createdAt + GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS.ticketTtlMs
  ) throw new TypeError('expiresAt must be within the five-minute provisioning TTL');
  return Object.freeze({
    ticketFingerprint: fingerprint43(input.ticketFingerprint, 'ticketFingerprint'),
    identityFingerprint: fingerprint64(input.identityFingerprint, 'identityFingerprint'),
    keyId: keyId(input.keyId),
    createdAt,
    expiresAt,
  });
}

function normalizeRedeem(input, defaultNow) {
  return Object.freeze({
    ticketFingerprint: fingerprint43(input.ticketFingerprint, 'ticketFingerprint'),
    identityFingerprint: fingerprint64(input.identityFingerprint, 'identityFingerprint'),
    keyId: keyId(input.keyId),
    challengeFingerprint: fingerprint43(input.challengeFingerprint, 'challengeFingerprint'),
    now: timestamp(input.now ?? defaultNow, 'now'),
  });
}

function normalizeConfirmation(input, defaultNow) {
  return normalizeRedeem(input, defaultNow);
}

function assertTicketBinding(ticket, expected, allowedStatuses) {
  if (!ticket) {
    throw permanentError('Google Ads provisioning capability is unavailable', {
      code: 'GOOGLE_ADS_PROVISIONING_TICKET_UNAVAILABLE',
    });
  }
  if (
    ticket.identityFingerprint !== expected.identityFingerprint
    || ticket.keyId !== expected.keyId
    || (
      expected.challengeFingerprint
      && ticket.challengeFingerprint !== expected.challengeFingerprint
    )
  ) {
    throw permanentError('Google Ads provisioning capability binding does not match', {
      code: 'GOOGLE_ADS_PROVISIONING_IDENTITY_MISMATCH',
    });
  }
  if (expected.now > ticket.expiresAt) throw classifyUnusable(ticket, expected);
  if (!allowedStatuses.includes(ticket.status)) throw classifyUnusable(ticket, expected);
  return ticket;
}

function classifyUnusable(ticket, expected) {
  if (!ticket) {
    return permanentError('Google Ads provisioning capability is unavailable', {
      code: 'GOOGLE_ADS_PROVISIONING_TICKET_UNAVAILABLE',
    });
  }
  if (
    ticket.identityFingerprint !== expected.identityFingerprint
    || ticket.keyId !== expected.keyId
  ) {
    return permanentError('Google Ads provisioning capability binding does not match', {
      code: 'GOOGLE_ADS_PROVISIONING_IDENTITY_MISMATCH',
    });
  }
  return permanentError('Google Ads provisioning capability is no longer usable', {
    code: 'GOOGLE_ADS_PROVISIONING_TICKET_UNUSABLE',
    details: { status: ticket.status },
  });
}

function mapTicket(row) {
  const status = choice(row.status, GOOGLE_ADS_SIGNING_PROVISIONING_STATUSES, 'status');
  return Object.freeze({
    ticketFingerprint: fingerprint43(row.ticket_fingerprint, 'ticketFingerprint'),
    identityFingerprint: fingerprint64(row.identity_fingerprint, 'identityFingerprint'),
    keyId: keyId(row.key_id),
    status,
    createdAt: timestamp(row.created_at, 'createdAt'),
    expiresAt: timestamp(row.expires_at, 'expiresAt'),
    redeemedAt: nullableTimestamp(row.redeemed_at),
    confirmedAt: nullableTimestamp(row.confirmed_at),
    challengeFingerprint: row.challenge_fingerprint === null
      ? null
      : fingerprint43(row.challenge_fingerprint, 'challengeFingerprint'),
  });
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1GoogleAdsSigningSecretProvisioningStore requires D1 prepare()');
  }
  return value;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function keyId(value) {
  const normalized = text(value, 'keyId');
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(normalized)) throw new TypeError('keyId is invalid');
  return normalized;
}

function fingerprint43(value, fieldName) {
  const normalized = text(value, fieldName);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(normalized)) throw new TypeError(`${fieldName} is invalid`);
  return normalized;
}

function fingerprint64(value, fieldName) {
  const normalized = text(value, fieldName);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new TypeError(`${fieldName} is invalid`);
  return normalized;
}

function choice(value, choices, fieldName) {
  const normalized = text(value, fieldName);
  if (!choices.includes(normalized)) throw new TypeError(`${fieldName} is invalid`);
  return normalized;
}

function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Google Ads provisioning store requires ${fieldName}`);
  }
  return value.trim();
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative timestamp`);
  }
  return number;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : timestamp(value, 'timestamp');
}

function unavailable(message, code, cause) {
  return transientError(message, { code, cause });
}
