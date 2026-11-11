import type { LocalStore } from '../local-store/local-store';
import { ChangeApplier } from './change-applier';
import { ChangePuller } from './change-puller';
import { HttpSyncTransport } from './http-sync-transport';
import { OutboxSynchronizer } from './outbox-synchronizer';
import { registerIdOf } from './register-identity';
import { SyncOutbox } from './sync-outbox';
import { DEFAULT_PULL_INTERVAL_MS, SyncScheduler } from './sync-scheduler';

/** The two loops that keep the register and the core in step, stopped together. */
export interface SyncLoops {
  /** Stops both loops. A request already on the wire finishes, but no other starts. */
  stop(): void;
  /** Pushes and pulls now and forgets the failures, for when the connection comes back. */
  nudge(): void;
}

/**
 * Starts the loops that talk to the core, if the register was told where the core is: one sends the outbox, and the other
 * downloads the catalog, prices and permissions that changed (RF-023). Each runs apart from the other and from the sales,
 * so a core that answers slowly, or never, stops neither the other loop nor a sale. Without an address the register sells exactly the same and just keeps the operations in its outbox, because the core does not exist for every
 * install yet. Nothing here can stop a sale: a failure is logged and tried again later.
 *
 * @param store the open local database
 * @param tenantId the business of this register
 * @param coreUrl the address of the core, such as `https://core.example.com`, or undefined to stay offline
 * @returns the running loops, or null when no address was given
 */
export function startSyncIfConfigured(store: LocalStore, tenantId: string, coreUrl: string | undefined): SyncLoops | null {
  if (coreUrl === undefined || coreUrl.trim() === '') {
    return null;
  }
  const transport = new HttpSyncTransport({ baseUrl: coreUrl.trim() });
  const pusher = new SyncScheduler({
    synchronizer: new OutboxSynchronizer({
      outbox: new SyncOutbox(store, tenantId),
      transport,
      registerId: registerIdOf(store, tenantId),
    }),
    onRun: ({ failure, remaining }) => {
      if (failure !== null) {
        console.warn(`Sync is waiting: ${failure.message} (${remaining} operations pending)`);
      }
    },
  });
  const puller = new ChangePuller({ applier: new ChangeApplier(store, tenantId), transport });
  const pullLoop = new SyncScheduler({
    synchronizer: { pushPending: () => puller.pullAll() },
    intervalMs: DEFAULT_PULL_INTERVAL_MS,
    onRun: ({ failure }) => {
      if (failure !== null) {
        console.warn(`Catalog updates are waiting: ${failure.message}`);
      }
    },
  });
  pusher.start();
  pullLoop.start();
  return {
    stop: () => {
      pusher.stop();
      pullLoop.stop();
    },
    nudge: () => {
      pusher.nudge();
      pullLoop.nudge();
    },
  };
}
