/** What a person can do at the register. The owner can do everything, and a cashier cannot authorize or manage people. */
export const USER_ROLES = ['owner', 'cashier'] as const;

/** One of the roles. */
export type UserRole = (typeof USER_ROLES)[number];

/** A person who can sign in. It never carries the PIN or its hash. */
export interface UserSummary {
  /** UUIDv7 of the user. */
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
}

/** How a sign-in attempt ended. */
export type LoginResult =
  | { readonly status: 'ok'; readonly user: UserSummary }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  /** Too many wrong PINs. Even the right one is refused until this moment, in ISO 8601. */
  | { readonly status: 'locked'; readonly until: string }
  | { readonly status: 'unknown_user' };

/** The longest name a person can have at the register. */
export const MAX_USER_NAME_LENGTH = 40;
