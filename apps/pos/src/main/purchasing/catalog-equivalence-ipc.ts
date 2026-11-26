import {
  EQUIVALENCE_CHANNELS,
  MAX_GROUP_ITEMS,
  MAX_GROUP_NAME_LENGTH,
  MAX_SYNONYM_LENGTH,
  type AddSynonymResult,
  type ApproveEquivalenceRequest,
  type ApproveEquivalenceResult,
  type AskAiResult,
  type EquivalenceGroup,
  type OwnerSynonym,
  type ProposeEquivalencesResult,
  type RemoveFromEquivalenceRequest,
  type RemoveFromEquivalenceResult,
} from '../../shared/catalog-equivalence';
import type { UserSummary } from '../../shared/auth';
import type { CatalogEquivalenceService } from './catalog-equivalence-service';
import { parseUuid } from './purchasing-request';
import type { AnswerSignedInWithUser } from './supplier-catalog-ipc';

/** The longest words the screen may send to look for. */
const MAX_SEARCH_LENGTH = 100;
/** The longest reason of a proposal. */
const MAX_REASON_LENGTH = 300;

function asRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, description: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TypeError(`Expected ${description} as text of at most ${maxLength} characters`);
  }
  return value;
}

function parseItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GROUP_ITEMS) {
    throw new TypeError(`Expected between 1 and ${MAX_GROUP_ITEMS} items`);
  }
  return value.map((id: unknown) => parseUuid(id, 'an item'));
}

/**
 * Checks an approval that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseApproveEquivalenceRequest(value: unknown): ApproveEquivalenceRequest {
  const request = asRecord(value, 'an approval of equivalent products');
  if (request.origin !== 'rules' && request.origin !== 'ai' && request.origin !== 'manual') {
    throw new TypeError('Expected who proposed the group');
  }
  const score = request.score;
  if (score !== null && (typeof score !== 'number' || !Number.isSafeInteger(score) || score < 0 || score > 100)) {
    throw new TypeError('Expected a score from 0 to 100 or null');
  }
  return {
    itemIds: parseItemIds(request.itemIds),
    groupId: request.groupId === null ? null : parseUuid(request.groupId, 'a group'),
    name: requireText(request.name, 'the name of the group', MAX_GROUP_NAME_LENGTH),
    origin: request.origin,
    score,
    reason: requireText(request.reason, 'the reason', MAX_REASON_LENGTH),
  };
}

/**
 * Checks a request to take an item out of its group.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseRemoveFromEquivalenceRequest(value: unknown): RemoveFromEquivalenceRequest {
  const request = asRecord(value, 'an item to take out of its group');
  return { groupId: parseUuid(request.groupId, 'a group'), itemId: parseUuid(request.itemId, 'an item') };
}

/**
 * Checks a word for the dictionary.
 *
 * @param value what the screen sent
 * @returns the word and what it means
 * @throws TypeError if it is not shaped as one
 */
export function parseOwnerSynonym(value: unknown): OwnerSynonym {
  const request = asRecord(value, 'a word for the dictionary');
  return { term: requireText(request.term, 'the word', MAX_SYNONYM_LENGTH), canonical: requireText(request.canonical, 'what it means', MAX_SYNONYM_LENGTH) };
}

/**
 * Registers the channels of the equivalent products (E1-63). Every one is for the owner, because the lists carry the costs
 * of the business and asking Claude costs money.
 *
 * @param answerSignedIn registers a channel that needs a person signed in
 * @param refuse builds the error for a person who may not do something
 * @param equivalences the service
 */
export function registerEquivalenceHandlers(answerSignedIn: AnswerSignedInWithUser, refuse: (message: string) => Error, equivalences: CatalogEquivalenceService): void {
  const answerOwner = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result): void =>
    answerSignedIn(channel, (argument, user) => {
      if (user.role !== 'owner') {
        throw refuse('Only the owner sees the equivalent products of the suppliers');
      }
      return respond(argument, user);
    });
  answerOwner(EQUIVALENCE_CHANNELS.proposeEquivalences, (value): ProposeEquivalencesResult => equivalences.propose(requireText(value, 'words', MAX_SEARCH_LENGTH)));
  answerOwner(EQUIVALENCE_CHANNELS.askAiForEquivalences, (value): Promise<AskAiResult> => equivalences.askAi(requireText(value, 'words', MAX_SEARCH_LENGTH)));
  answerOwner(EQUIVALENCE_CHANNELS.aiAvailable, (): boolean => equivalences.aiAvailable());
  answerOwner(EQUIVALENCE_CHANNELS.approveEquivalence, (value, user): ApproveEquivalenceResult => equivalences.approve(parseApproveEquivalenceRequest(value), user.id));
  answerOwner(EQUIVALENCE_CHANNELS.rejectEquivalence, (value, user): { status: 'rejected' } => equivalences.reject(parseItemIds(value), user.id));
  answerOwner(EQUIVALENCE_CHANNELS.listEquivalenceGroups, (value): EquivalenceGroup[] => equivalences.groups(requireText(value, 'words', MAX_SEARCH_LENGTH)));
  answerOwner(EQUIVALENCE_CHANNELS.removeFromEquivalence, (value, user): RemoveFromEquivalenceResult => equivalences.remove(parseRemoveFromEquivalenceRequest(value), user.id));
  answerOwner(EQUIVALENCE_CHANNELS.listSynonyms, (): OwnerSynonym[] => equivalences.synonyms());
  answerOwner(EQUIVALENCE_CHANNELS.addSynonym, (value, user): AddSynonymResult => equivalences.addSynonym(parseOwnerSynonym(value), user.id));
  answerOwner(EQUIVALENCE_CHANNELS.removeSynonym, (value, user): { status: 'removed' } => equivalences.removeSynonym(requireText(value, 'the word', MAX_SYNONYM_LENGTH), user.id));
}
