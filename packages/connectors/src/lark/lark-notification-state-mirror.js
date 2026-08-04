import { bangkokDateToEpochMilliseconds } from '../shared/date-time.js';
import {
  createLarkNotificationStateMirror as createBaseLarkNotificationStateMirror,
} from './lark-notification-delivery-source.js';

/**
 * Adapts the domain date-only Report period into the physical Lark DateTime contract.
 * The underlying mirror, TableSyncEngine and D1 authority remain unchanged.
 */
export function createLarkNotificationStateMirror(input = {}) {
  const mirror = createBaseLarkNotificationStateMirror(input);
  return async function mirrorNotificationState(row = {}) {
    return mirror(Object.freeze({
      ...row,
      period_start: bangkokDateToEpochMilliseconds(row.period_start, {
        label: 'notification period_start',
      }),
      period_end: bangkokDateToEpochMilliseconds(row.period_end, {
        label: 'notification period_end',
      }),
    }));
  };
}
