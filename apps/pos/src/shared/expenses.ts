/**
 * The operating expenses of the business: rent, power, wages (E1-56, ADR 0072). Only the owner records them, or a cashier
 * with the PIN of an owner. An expense paid from the drawer is also a cash exit, so the cut subtracts it once.
 */

/** The concepts the register offers until the owner changes the list. */
export const DEFAULT_EXPENSE_CONCEPTS: readonly string[] = [
  'Renta',
  'Luz',
  'Agua',
  'Sueldos',
  'Internet y teléfono',
  'Mantenimiento',
  'Comisiones del banco',
  'Otros',
];

export const MAX_EXPENSE_CONCEPTS = 30;
export const MAX_CONCEPT_LENGTH = 40;
export const MAX_EXPENSE_NOTE = 120;
export const MAX_VOID_REASON = 120;
/** One million pesos: a bigger single expense is far more likely a typo than a real one. */
export const MAX_EXPENSE_CENTS = 100_000_000;

/** What the owner writes down. */
export interface ExpenseRequest {
  readonly concept: string;
  /** What was paid, in cents. */
  readonly amountCents: number;
  /** The day it was paid, `YYYY-MM-DD` in the time zone of the register. A drawer payment is always today. */
  readonly day: string;
  readonly note: string | null;
  /** True when the cash came out of the drawer: it is then a cash exit of the open session too. */
  readonly paidFromDrawer: boolean;
  /** The PIN of an owner, when a cashier records it. */
  readonly ownerPin?: string;
}

/** An expense as the list shows it. */
export interface Expense {
  readonly id: string;
  readonly concept: string;
  readonly amountCents: number;
  readonly day: string;
  readonly note: string | null;
  readonly paidFromDrawer: boolean;
  /** Who wrote it down, by name. */
  readonly recordedBy: string;
  readonly recordedAt: string;
  /** Why and when it was voided, or null while it counts. */
  readonly voided: { readonly at: string; readonly by: string; readonly reason: string } | null;
}

/** Why an owner's approval was not given. */
export type ExpenseRefusal =
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

export type RecordExpenseResult =
  | { readonly status: 'recorded'; readonly expense: Expense }
  /** The text of what is wrong, ready for the screen. */
  | { readonly status: 'invalid'; readonly message: string }
  /** A drawer payment needs an open cash session. */
  | { readonly status: 'no_session' }
  | ExpenseRefusal;

export interface ExpenseListRequest {
  /** First day, `YYYY-MM-DD`. */
  readonly fromDay: string;
  /** Last day, included. */
  readonly toDay: string;
  readonly ownerPin?: string;
}

export type ExpenseListResult =
  | { readonly status: 'ok'; readonly expenses: readonly Expense[]; readonly concepts: readonly string[] }
  | ExpenseRefusal;

export interface VoidExpenseRequest {
  readonly id: string;
  readonly reason: string;
  readonly ownerPin?: string;
}

export type VoidExpenseResult =
  /** `returnedToDrawer` is true when the cash went back into the open session that paid it. */
  | { readonly status: 'voided'; readonly returnedToDrawer: boolean }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_voided' }
  | { readonly status: 'invalid'; readonly message: string }
  | ExpenseRefusal;

export interface SaveConceptsRequest {
  readonly concepts: readonly string[];
  readonly ownerPin?: string;
}

export type SaveConceptsResult =
  | { readonly status: 'saved'; readonly concepts: readonly string[] }
  | { readonly status: 'invalid'; readonly message: string }
  | ExpenseRefusal;

/** The IPC channels of the expenses. */
export const EXPENSE_CHANNELS = {
  record: 'expenses:record',
  list: 'expenses:list',
  void: 'expenses:void',
  saveConcepts: 'expenses:save-concepts',
} as const;

/** What the screen can ask about the expenses. */
export interface ExpensesApi {
  /**
   * Writes an expense down. One paid from the drawer is also a cash exit of the open session.
   *
   * @param request the concept, the amount, the day, the note and where the money came from
   * @returns the expense, or why it was not recorded
   */
  record(request: ExpenseRequest): Promise<RecordExpenseResult>;

  /**
   * Lists the expenses of some days, voided ones included, and the concepts to choose from.
   *
   * @param request the days
   * @returns the expenses, the newest day first, or why they were not shown
   */
  list(request: ExpenseListRequest): Promise<ExpenseListResult>;

  /**
   * Voids an expense written by mistake. A drawer payment of a session that is still open puts the cash back.
   *
   * @param request the expense and why
   * @returns how it ended
   */
  void(request: VoidExpenseRequest): Promise<VoidExpenseResult>;

  /**
   * Replaces the list of concepts. Expenses already written keep the text they had.
   *
   * @param request the new list
   * @returns the list as saved, or why not
   */
  saveConcepts(request: SaveConceptsRequest): Promise<SaveConceptsResult>;
}
