import type { StatementSync } from 'node:sqlite';

import type { UserSummary } from '../../shared/auth';
import {
  DEFAULT_EXPENSE_CONCEPTS,
  MAX_CONCEPT_LENGTH,
  MAX_EXPENSE_CENTS,
  MAX_EXPENSE_CONCEPTS,
  MAX_EXPENSE_NOTE,
  MAX_VOID_REASON,
  type Expense,
  type ExpenseListRequest,
  type ExpenseListResult,
  type ExpenseRefusal,
  type ExpenseRequest,
  type RecordExpenseResult,
  type SaveConceptsRequest,
  type SaveConceptsResult,
  type VoidExpenseRequest,
  type VoidExpenseResult,
} from '../../shared/expenses';
import type { AuditLog } from '../audit/audit-log';
import { isRefusal, type OwnerGate } from '../auth/owner-gate';
import type { CashSessionStore } from '../cash/cash-session-store';
import type { LocalStore } from '../local-store/local-store';
import { localDayOf, parseDay } from '../reports/period';
import { uuidV7 } from '../uuid-v7';

const CONCEPTS_SETTING = 'expense_concepts';

interface ExpenseRowSql {
  readonly id: string;
  readonly concept: string;
  readonly amount_cents: number;
  readonly expense_day: string;
  readonly note: string | null;
  readonly paid_from_drawer: number;
  readonly cash_movement_id: string | null;
  readonly recorded_by_name: string | null;
  readonly recorded_at: string;
  readonly voided_at: string | null;
  readonly voided_by_name: string | null;
  readonly void_reason: string | null;
}

/** A reason the request cannot be recorded, in words for the screen. */
class InvalidExpenseError extends Error {}

function invalid(message: string): never {
  throw new InvalidExpenseError(message);
}

function toExpense(row: ExpenseRowSql): Expense {
  return {
    id: row.id,
    concept: row.concept,
    amountCents: row.amount_cents,
    day: row.expense_day,
    note: row.note,
    paidFromDrawer: row.paid_from_drawer === 1,
    recordedBy: row.recorded_by_name ?? 'Usuario borrado',
    recordedAt: row.recorded_at,
    voided:
      row.voided_at === null ? null : { at: row.voided_at, by: row.voided_by_name ?? 'Usuario borrado', reason: row.void_reason ?? '' },
  };
}

/**
 * Cleans a list of concepts: trims each one, drops the empty ones and the repeats (ignoring capitals), and checks the
 * limits.
 *
 * @param concepts what the owner typed
 * @returns the list, in the same order
 * @throws InvalidExpenseError if the list is empty, too long, or a concept is too long
 */
function cleanConcepts(concepts: readonly string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of concepts) {
    const concept = raw.trim().replace(/\s+/g, ' ');
    if (concept === '' || seen.has(concept.toLocaleLowerCase('es'))) {
      continue;
    }
    if (concept.length > MAX_CONCEPT_LENGTH) {
      invalid(`Cada concepto puede tener hasta ${String(MAX_CONCEPT_LENGTH)} letras.`);
    }
    seen.add(concept.toLocaleLowerCase('es'));
    clean.push(concept);
  }
  if (clean.length === 0) {
    invalid('Deja al menos un concepto.');
  }
  if (clean.length > MAX_EXPENSE_CONCEPTS) {
    invalid(`La lista puede tener hasta ${String(MAX_EXPENSE_CONCEPTS)} conceptos.`);
  }
  return clean;
}

/**
 * The book of operating expenses (E1-56, ADR 0072). Only an owner writes in it, or a cashier with the PIN of an owner.
 * An expense never changes: a mistake is voided with a reason, and everything is in the audit log. An expense paid from
 * the drawer writes its cash exit in the same transaction, so the cut subtracts it once and the income statement, which
 * reads only this book, counts it once.
 */
export class ExpenseBook {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #cash: Pick<CashSessionStore, 'findOpen' | 'writeMovement'>;
  readonly #gate: Pick<OwnerGate, 'authorize'>;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #now: () => Date;
  readonly #insert: StatementSync;
  readonly #findOne: StatementSync;
  readonly #listBetween: StatementSync;
  readonly #markVoided: StatementSync;
  readonly #sessionIsOpen: StatementSync;
  readonly #readSetting: StatementSync;
  readonly #writeSetting: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param cash the cash sessions, for the expenses paid from the drawer
   * @param gate who approves a cashier
   * @param audit where every change is written down
   * @param now the clock, so a test can move time
   */
  constructor(
    store: LocalStore,
    tenantId: string,
    cash: Pick<CashSessionStore, 'findOpen' | 'writeMovement'>,
    gate: Pick<OwnerGate, 'authorize'>,
    audit: Pick<AuditLog, 'record'>,
    now: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#cash = cash;
    this.#gate = gate;
    this.#audit = audit;
    this.#now = now;
    this.#insert = store.prepare(`
      INSERT INTO expense (id, tenant_id, concept, amount_cents, expense_day, note, paid_from_drawer, cash_movement_id, recorded_by, authorized_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const select = `
      SELECT e.id, e.concept, e.amount_cents, e.expense_day, e.note, e.paid_from_drawer, e.cash_movement_id, r.name AS recorded_by_name,
             e.recorded_at, e.voided_at, v.name AS voided_by_name, e.void_reason
      FROM expense e LEFT JOIN app_user r ON r.id = e.recorded_by LEFT JOIN app_user v ON v.id = e.voided_by`;
    this.#findOne = store.prepare(`${select} WHERE e.tenant_id = ? AND e.id = ?`);
    this.#listBetween = store.prepare(`${select} WHERE e.tenant_id = ? AND e.expense_day BETWEEN ? AND ? ORDER BY e.expense_day DESC, e.recorded_at DESC`);
    this.#markVoided = store.prepare('UPDATE expense SET voided_by = ?, voided_at = ?, void_reason = ? WHERE tenant_id = ? AND id = ?');
    this.#sessionIsOpen = store.prepare(`
      SELECT m.session_id AS sessionId FROM cash_movement m JOIN cash_session s ON s.id = m.session_id
      WHERE m.tenant_id = ? AND m.id = ? AND s.closed_at IS NULL
    `);
    this.#readSetting = store.prepare('SELECT value FROM register_setting WHERE tenant_id = ? AND name = ?');
    this.#writeSetting = store.prepare(`
      INSERT INTO register_setting (tenant_id, name, value) VALUES (?, ?, ?)
      ON CONFLICT (tenant_id, name) DO UPDATE SET value = excluded.value
    `);
  }

  /**
   * The concepts to choose from: the owner's list, or the default one.
   *
   * @returns the list
   */
  concepts(): string[] {
    const saved = (this.#readSetting.get(this.#tenantId, CONCEPTS_SETTING) as unknown as { value: string } | undefined)?.value ?? null;
    if (saved !== null) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === 'string')) {
          return parsed as string[];
        }
      } catch {
        // A damaged setting falls back to the default list rather than leaving the owner without concepts.
      }
    }
    return [...DEFAULT_EXPENSE_CONCEPTS];
  }

  /**
   * Writes an expense down.
   *
   * @param request what was paid, when, and where the money came from
   * @param user who is signed in
   * @returns the expense, or why it was not recorded
   */
  record(request: ExpenseRequest, user: UserSummary): RecordExpenseResult {
    const approval = this.#approve(user, request.ownerPin, 'tried to record an expense');
    if ('status' in approval) {
      return approval;
    }
    try {
      const concept = this.#knownConcept(request.concept);
      const amountCents = request.amountCents;
      if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_EXPENSE_CENTS) {
        invalid('Escribe un monto mayor que cero y de hasta un millón de pesos.');
      }
      const today = localDayOf(this.#now().getTime());
      const day = this.#validDay(request.day, today);
      if (request.paidFromDrawer && day !== today) {
        invalid('Un gasto pagado de la caja es de hoy, porque el efectivo sale ahora.');
      }
      const note = this.#cleanNote(request.note);
      const session = request.paidFromDrawer ? this.#cash.findOpen() : null;
      if (request.paidFromDrawer && session === null) {
        return { status: 'no_session' };
      }
      const id = uuidV7();
      this.#store.transaction(() => {
        const movementId =
          session === null ? null : this.#cash.writeMovement(session.id, 'out', amountCents, `Gasto: ${concept}`, user.id, approval.ownerId === user.id ? null : approval.ownerId);
        this.#insert.run(id, this.#tenantId, concept, amountCents, day, note, session === null ? 0 : 1, movementId, user.id, approval.ownerId, this.#now().toISOString());
        this.#audit.record({
          userId: user.id,
          action: 'expense.recorded',
          entity: 'expense',
          entityId: id,
          detail: `${concept} ${String(amountCents)} centavos del ${day}${session === null ? '' : ', pagado de la caja'}${note === null ? '' : `: ${note}`}`,
        });
      });
      return { status: 'recorded', expense: this.#read(id) };
    } catch (error) {
      if (error instanceof InvalidExpenseError) {
        return { status: 'invalid', message: error.message };
      }
      throw error;
    }
  }

  /**
   * Lists the expenses of some days, voided ones included so the owner sees what was fixed.
   *
   * @param request the days
   * @param user who is signed in
   * @returns the expenses and the concepts, or why not
   * @throws RangeError if a day does not exist or the range is backwards
   */
  list(request: ExpenseListRequest, user: UserSummary): ExpenseListResult {
    const approval = this.#approve(user, request.ownerPin, 'tried to read the expenses');
    if ('status' in approval) {
      return approval;
    }
    if (parseDay(request.toDay) < parseDay(request.fromDay)) {
      throw new RangeError('The range ends before it starts');
    }
    const rows = this.#listBetween.all(this.#tenantId, request.fromDay, request.toDay) as unknown as ExpenseRowSql[];
    return { status: 'ok', expenses: rows.map(toExpense), concepts: this.concepts() };
  }

  /**
   * Voids an expense. If it was paid from the drawer and that session is still open, the cash goes back in with an entry,
   * so the cut balances again. If the session is closed, the cash is left alone: the cut was already made without it.
   *
   * @param request the expense and why
   * @param user who is signed in
   * @returns how it ended
   */
  void(request: VoidExpenseRequest, user: UserSummary): VoidExpenseResult {
    const approval = this.#approve(user, request.ownerPin, 'tried to void an expense');
    if ('status' in approval) {
      return approval;
    }
    const reason = request.reason.trim();
    if (reason === '' || reason.length > MAX_VOID_REASON) {
      return { status: 'invalid', message: `Escribe por qué se anula, en hasta ${String(MAX_VOID_REASON)} letras.` };
    }
    const row = this.#findOne.get(this.#tenantId, request.id) as unknown as ExpenseRowSql | undefined;
    if (row === undefined) {
      return { status: 'not_found' };
    }
    if (row.voided_at !== null) {
      return { status: 'already_voided' };
    }
    const openSession =
      row.cash_movement_id === null ? null : ((this.#sessionIsOpen.get(this.#tenantId, row.cash_movement_id) as unknown as { sessionId: string } | undefined) ?? null);
    this.#store.transaction(() => {
      if (openSession !== null) {
        this.#cash.writeMovement(openSession.sessionId, 'in', row.amount_cents, `Anulación de gasto: ${row.concept}`, user.id, approval.ownerId === user.id ? null : approval.ownerId);
      }
      this.#markVoided.run(user.id, this.#now().toISOString(), reason, this.#tenantId, row.id);
      this.#audit.record({
        userId: user.id,
        action: 'expense.voided',
        entity: 'expense',
        entityId: row.id,
        detail: `${row.concept} ${String(row.amount_cents)} centavos del ${row.expense_day}: ${reason}${openSession === null ? '' : ', regresó a la caja'}`,
      });
    });
    return { status: 'voided', returnedToDrawer: openSession !== null };
  }

  /**
   * Replaces the list of concepts.
   *
   * @param request the new list
   * @param user who is signed in
   * @returns the list as saved, or why not
   */
  saveConcepts(request: SaveConceptsRequest, user: UserSummary): SaveConceptsResult {
    const approval = this.#approve(user, request.ownerPin, 'tried to change the expense concepts');
    if ('status' in approval) {
      return approval;
    }
    try {
      const concepts = cleanConcepts(request.concepts);
      const before = this.concepts();
      this.#store.transaction(() => {
        this.#writeSetting.run(this.#tenantId, CONCEPTS_SETTING, JSON.stringify(concepts));
        this.#audit.record({
          userId: user.id,
          action: 'expense.concepts_changed',
          entity: 'expense_concepts',
          entityId: CONCEPTS_SETTING,
          detail: `${before.join(', ')} → ${concepts.join(', ')}`,
        });
      });
      return { status: 'saved', concepts };
    } catch (error) {
      if (error instanceof InvalidExpenseError) {
        return { status: 'invalid', message: error.message };
      }
      throw error;
    }
  }

  #approve(user: UserSummary, ownerPin: string | undefined, deniedDetail: string): { ownerId: string } | ExpenseRefusal {
    const approval = this.#gate.authorize({ user, ownerPin, deniedAction: 'expense.denied', entity: 'expense', entityId: 'book', deniedDetail });
    return isRefusal(approval) ? approval : { ownerId: approval.ownerId };
  }

  #knownConcept(text: string): string {
    const concept = text.trim().replace(/\s+/g, ' ');
    const match = this.concepts().find((candidate) => candidate.toLocaleLowerCase('es') === concept.toLocaleLowerCase('es'));
    if (match === undefined) {
      invalid('Elige un concepto de la lista. El dueño puede agregar otros.');
    }
    return match;
  }

  #validDay(text: string, today: string): string {
    try {
      parseDay(text);
    } catch {
      invalid('Revisa la fecha del gasto.');
    }
    if (text > today) {
      invalid('La fecha del gasto no puede ser futura.');
    }
    return text;
  }

  #cleanNote(note: string | null): string | null {
    const text = note?.trim() ?? '';
    if (text.length > MAX_EXPENSE_NOTE) {
      invalid(`La nota puede tener hasta ${String(MAX_EXPENSE_NOTE)} letras.`);
    }
    return text === '' ? null : text;
  }

  #read(id: string): Expense {
    return toExpense(this.#findOne.get(this.#tenantId, id) as unknown as ExpenseRowSql);
  }
}
