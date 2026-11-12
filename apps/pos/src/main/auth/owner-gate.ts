import type { UserRole } from '../../shared/auth';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from './auth-service';

/** Why an owner's approval was not given. */
export type OwnerRefusal =
  /** A cashier asked without the PIN of an owner. */
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** The owner who approved an action: the one who is signed in, or the one whose PIN a cashier typed. */
export interface OwnerApproval {
  readonly ownerId: string;
}

/** What one approval is for, so a refusal can be written down with it. */
export interface ApprovalRequest {
  /** The person who asks, who is signed in. */
  readonly user: { readonly id: string; readonly role: UserRole };
  /** The PIN of an owner, when a cashier asks. */
  readonly ownerPin?: string | undefined;
  /** The audit action of a refusal, such as `product.create_denied`. */
  readonly deniedAction: string;
  readonly entity: string;
  readonly entityId: string;
  /** What the person tried, which goes after the reason of the refusal in the audit detail. */
  readonly deniedDetail: string;
}

/**
 * The rule every sensitive action of the catalog shares (ADR 0047): the owner who is signed in approves by being there, and
 * a cashier needs the PIN of an owner. Every refusal is written in the audit log under the name of the person who asked, so
 * a failed attempt counts as much as a good one. There is no manager role in the register: if one is added, it joins this
 * rule in one place.
 */
export class OwnerGate {
  readonly #auth: Pick<AuthService, 'authorizeWithOwnerPin'>;
  readonly #audit: Pick<AuditLog, 'record'>;

  /**
   * @param auth who can approve with a PIN
   * @param audit where the refusals are written down
   */
  constructor(auth: Pick<AuthService, 'authorizeWithOwnerPin'>, audit: Pick<AuditLog, 'record'>) {
    this.#auth = auth;
    this.#audit = audit;
  }

  /**
   * Asks for the approval of an owner. A refusal is audited here, so it must run outside the transaction of the change: a
   * rollback would otherwise take the entry with it.
   *
   * @param request who asks, with which PIN, and what to write down if it is refused
   * @returns the owner who approved, or why nobody did
   */
  authorize(request: ApprovalRequest): OwnerApproval | OwnerRefusal {
    if (request.user.role === 'owner') {
      return { ownerId: request.user.id };
    }
    const refuse = <Refusal extends OwnerRefusal>(refusal: Refusal): Refusal => {
      this.#audit.record({
        userId: request.user.id,
        action: request.deniedAction,
        entity: request.entity,
        entityId: request.entityId,
        detail: `${refusal.status}: ${request.deniedDetail}`,
      });
      return refusal;
    };
    if (request.ownerPin === undefined || request.ownerPin === '') {
      return refuse({ status: 'authorization_required' });
    }
    const result = this.#auth.authorizeWithOwnerPin(request.ownerPin);
    if (result.status === 'ok') {
      return { ownerId: result.owner.id };
    }
    return refuse(result);
  }
}

/**
 * Tells a refusal from an approval.
 *
 * @param outcome what `OwnerGate.authorize` answered
 * @returns true if nobody approved
 */
export function isRefusal(outcome: OwnerApproval | OwnerRefusal): outcome is OwnerRefusal {
  return 'status' in outcome;
}
