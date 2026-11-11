import type { LocalStore } from '../local-store/local-store';
import { HttpSyncTransport } from './http-sync-transport';
import { OutboxSynchronizer } from './outbox-synchronizer';
import { registerIdOf } from './register-identity';
import { SyncOutbox } from './sync-outbox';
import { SyncScheduler } from './sync-scheduler';

/**
 * Starts the loop that sends the outbox to the core, if the register was told where the core is. Without an address the
 * register sells exactly the same and just keeps the operations in its outbox, because the core does not exist for every
 * install yet. Nothing here can stop a sale: a failure is logged and tried again later.
 *
 * @param store the open local database
 * @param tenantId the business of this register
 * @param coreUrl the address of the core, such as `https://core.example.com`, or undefined to stay offline
 * @param deviceToken the device credential received when the register enrolled, or undefined if it is not enrolled yet
 * @returns the running loop, or null when no address was given
 */
export function startSyncIfConfigured(
  store: LocalStore,
  tenantId: string,
  coreUrl: string | undefined,
  deviceToken?: string,
): SyncScheduler | null {
  if (coreUrl === undefined || coreUrl.trim() === '') {
    return null;
  }
  const scheduler = new SyncScheduler({
    synchronizer: new OutboxSynchronizer({
      outbox: new SyncOutbox(store, tenantId),
      transport: new HttpSyncTransport({ baseUrl: coreUrl.trim(), ...(deviceToken === undefined ? {} : { deviceToken }) }),
      registerId: registerIdOf(store, tenantId),
    }),
    onRun: ({ failure, remaining }) => {
      if (failure !== null) {
        console.warn(`Sync is waiting: ${failure.message} (${remaining} operations pending)`);
      }
    },
  });
  scheduler.start();
  return scheduler;
}
