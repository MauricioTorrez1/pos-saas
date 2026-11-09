import { MAX_USER_NAME_LENGTH, USER_ROLES, type UserRole } from '../../shared/auth';

const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, description: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TypeError(`Expected ${description} of at most ${maxLength} characters`);
  }
  return value;
}

/**
 * Checks the PIN that crossed the bridge. Whether it is four to eight digits is checked where it is used, so a wrong PIN
 * and a badly formed one look the same to the person typing.
 *
 * @param value whatever the screen sent
 * @returns the PIN as text
 * @throws TypeError if it is not text of at most 8 characters
 */
export function parsePin(value: unknown): string {
  return requireText(value, 'a PIN', 8);
}

/**
 * Checks a request to sign in.
 *
 * @param value whatever crossed the bridge
 * @returns the user and the PIN
 * @throws TypeError if any field is missing or malformed
 */
export function parseLoginRequest(value: unknown): { userId: string; pin: string } {
  const request = requireRecord(value, 'a sign-in request');
  const { userId } = request;
  if (typeof userId !== 'string' || !UUID_V7_TEXT.test(userId)) {
    throw new TypeError('Expected the UUIDv7 of a user');
  }
  return { userId, pin: parsePin(request.pin) };
}

/**
 * Checks a request to create the owner.
 *
 * @param value whatever crossed the bridge
 * @returns the name and the PIN
 * @throws TypeError if any field is missing or malformed
 */
export function parseSetupRequest(value: unknown): { name: string; pin: string } {
  const request = requireRecord(value, 'a setup request');
  return { name: requireText(request.name, 'a name', MAX_USER_NAME_LENGTH), pin: parsePin(request.pin) };
}

/**
 * Checks a request to add a person.
 *
 * @param value whatever crossed the bridge
 * @returns the name, the role, and the PIN
 * @throws TypeError if any field is missing or malformed, or the role is not one the register has
 */
export function parseCreateUserRequest(value: unknown): { name: string; role: UserRole; pin: string } {
  const request = requireRecord(value, 'a request to add a person');
  const role = USER_ROLES.find((known) => known === request.role);
  if (role === undefined) {
    throw new TypeError(`Expected a role: ${USER_ROLES.join(' or ')}`);
  }
  return { name: requireText(request.name, 'a name', MAX_USER_NAME_LENGTH), role, pin: parsePin(request.pin) };
}
