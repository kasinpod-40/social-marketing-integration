const INCIDENT = Object.freeze({
  dlqId: 'dlq:8d1b9077657385a417cb32a0ed3114cb',
  operationId: 'f59b852f00634005c7ff4da51afee964',
  workKey: 'tiktok:f59b852f00634005c7ff4da51afee964',
  generation: 1784829780000,
  originalRequestedAt: 1784829780000,
});

const recoveryReference = process.env.RECOVERY_REFERENCE?.trim()
  || `recovery:${INCIDENT.dlqId}:${INCIDENT.workKey}`;

const job = Object.freeze({
  schemaVersion: 1,
  type: 'tiktok.creator.native.history.recover',
  trigger: 'manual_recovery',
  ...INCIDENT,
  requestedAt: new Date(INCIDENT.originalRequestedAt).toISOString(),
  recoveryReference,
  dryRun: false,
});

// Payload-only helper: exact incident contract, no Queue send and no Remote action.
console.log(JSON.stringify(job, null, 2));
