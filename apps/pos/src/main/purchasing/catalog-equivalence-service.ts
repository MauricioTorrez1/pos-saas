import type { StatementSync } from 'node:sqlite';

import {
  MAX_GROUP_NAME_LENGTH,
  MAX_SYNONYM_LENGTH,
  type AddSynonymResult,
  type ApproveEquivalenceRequest,
  type ApproveEquivalenceResult,
  type AskAiResult,
  type EquivalenceConfidence,
  type EquivalenceGroup,
  type EquivalenceItem,
  type EquivalenceProposal,
  type OwnerSynonym,
  type ProposeEquivalencesResult,
  type RemoveFromEquivalenceRequest,
  type RemoveFromEquivalenceResult,
} from '../../shared/catalog-equivalence';
import {
  HIGH_CONFIDENCE_THRESHOLD,
  buildSynonymIndex,
  conflictOf,
  extractFeatures,
  matchPairKey,
  normalizeText,
  proposeMatches,
  synonymSearchTexts,
  type SynonymIndex,
} from '../../shared/catalog-matching';
import type { CatalogItem } from '../../shared/supplier-catalog';
import type { AuditLog } from '../audit/audit-log';
import type { LocalStore } from '../local-store/local-store';
import { toPrefixQuery } from '../local-store/product-catalog';
import { uuidV7 } from '../uuid-v7';
import { ITEM_SELECT, toCatalogItem, withPiecesFromDescription, type ItemRow } from './supplier-catalog-service';

/** The most proposals one search returns. */
const MAX_PROPOSALS = 200;
/** The most items one request to Claude carries, so one call stays cheap and its answer fits. */
export const MAX_AI_ITEMS = 120;

/** An item as it is sent to the analytics service: no costs, and the supplier as a letter, never its name. */
export interface AssistItem {
  readonly id: string;
  readonly supplier: string;
  readonly description: string;
  readonly purchase_unit: string | null;
  readonly pieces_per_unit: string;
}

/** A group Claude proposed. */
export interface AssistGroup {
  readonly item_ids: readonly string[];
  readonly reason: string;
  readonly confidence: EquivalenceConfidence;
}

export type AssistResponse = { readonly status: 'ok'; readonly groups: readonly AssistGroup[] } | { readonly status: 'failed'; readonly message: string };

/** Whoever asks Claude to group items; the analytics service in the store, a fake in tests. */
export interface EquivalenceAssistant {
  group(items: readonly AssistItem[]): Promise<AssistResponse>;
}

interface DecisionRow {
  readonly supplier_id: string;
  readonly supplier_code: string;
  readonly other_supplier_id: string;
  readonly other_supplier_code: string;
}

function itemKey(supplierId: string, supplierCode: string): string {
  return `${supplierId}\u0000${supplierCode.toLowerCase()}`;
}

function toEquivalenceItem(item: CatalogItem): EquivalenceItem {
  return {
    itemId: item.id,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    supplierCode: item.supplierCode,
    description: item.description,
    purchaseUnit: item.purchaseUnit,
    piecesPerUnitMilli: item.piecesPerUnitMilli,
    baseUnitCostE6: item.baseUnitCostE6,
    productName: item.productName,
  };
}

function confidenceOf(score: number): EquivalenceConfidence {
  return score >= HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'medium';
}

function shortestDescription(items: readonly CatalogItem[]): string {
  const shortest = [...items].sort((left, right) => left.description.length - right.description.length)[0]?.description ?? '';
  return shortest.slice(0, MAX_GROUP_NAME_LENGTH);
}

/**
 * Equivalent products across supplier catalogs (E1-63, ADR 0079). The rules of the register propose groups without
 * internet; Claude, through the analytics service, may propose more for what the rules could not group; the owner approves,
 * rejects or edits each one. Every decision is a new row that is never changed, with its audit entry, and names the item
 * by its supplier and code, so a new list of the same supplier keeps it. Only the owner reaches it, which the bridge checks.
 */
export class CatalogEquivalenceService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #assistant: EquivalenceAssistant | null;
  readonly #allItems: StatementSync;
  readonly #searchItems: StatementSync;
  readonly #itemById: StatementSync;
  readonly #groupItems: StatementSync;
  readonly #groupNames: StatementSync;
  readonly #groupName: StatementSync;
  readonly #rejections: StatementSync;
  readonly #insertDecision: StatementSync;
  readonly #ownerSynonyms: StatementSync;
  readonly #upsertSynonym: StatementSync;
  readonly #deleteSynonym: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param audit the audit log
   * @param assistant asks Claude through the analytics service, or null when the register has no address for it
   */
  constructor(store: LocalStore, tenantId: string, audit: Pick<AuditLog, 'record'>, assistant: EquivalenceAssistant | null) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#audit = audit;
    this.#assistant = assistant;
    this.#allItems = store.prepare(`${ITEM_SELECT} WHERE item.tenant_id = ? AND supplier.is_active = 1 ORDER BY item.description COLLATE NOCASE`);
    this.#searchItems = store.prepare(`
      ${ITEM_SELECT}
      WHERE item.tenant_id = ? AND supplier.is_active = 1
        AND item.local_rowid IN (SELECT rowid FROM supplier_catalog_search WHERE supplier_catalog_search MATCH ?)
    `);
    this.#itemById = store.prepare(`${ITEM_SELECT} WHERE item.tenant_id = ? AND item.id = ?`);
    this.#groupItems = store.prepare(`${ITEM_SELECT} WHERE item.tenant_id = ? AND member.group_id IS NOT NULL ORDER BY supplier.name COLLATE NOCASE`);
    this.#groupNames = store.prepare('SELECT group_id, name FROM catalog_equivalence_name WHERE tenant_id = ? ORDER BY name COLLATE NOCASE');
    this.#groupName = store.prepare('SELECT name FROM catalog_equivalence_name WHERE tenant_id = ? AND group_id = ?');
    this.#rejections = store.prepare("SELECT supplier_id, supplier_code, other_supplier_id, other_supplier_code FROM catalog_match_decision WHERE tenant_id = ? AND kind = 'reject'");
    this.#insertDecision = store.prepare(`
      INSERT INTO catalog_match_decision
        (id, tenant_id, kind, group_id, supplier_id, supplier_code, other_supplier_id, other_supplier_code, name, origin, score, reason, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#ownerSynonyms = store.prepare('SELECT term, canonical FROM catalog_synonym WHERE tenant_id = ? ORDER BY term');
    this.#upsertSynonym = store.prepare(`
      INSERT INTO catalog_synonym (tenant_id, term, canonical, created_by, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, term) DO UPDATE SET canonical = excluded.canonical, created_by = excluded.created_by, created_at = excluded.created_at
    `);
    this.#deleteSynonym = store.prepare('DELETE FROM catalog_synonym WHERE tenant_id = ? AND term = ?');
  }

  /** @returns whether Claude can be asked */
  aiAvailable(): boolean {
    return this.#assistant !== null;
  }

  /**
   * Proposes groups of equivalent items with the rules of the register, without internet.
   *
   * @param text words to look at only some items, with their synonyms; empty looks at every list
   * @returns the proposals, the most likely first
   */
  propose(text: string): ProposeEquivalencesResult {
    const index = this.#index();
    const items = this.#items(text, index);
    return { proposals: this.#ruleProposals(items, index).slice(0, MAX_PROPOSALS), examinedCount: items.length };
  }

  /**
   * Sends to Claude the items the rules could not group, through the analytics service. Only descriptions, units and
   * pieces travel, with the suppliers as letters: no costs and no names. Every group Claude proposes is checked again with
   * the rules: one item per supplier, no pair the owner rejected, and no two items whose measures or materials differ.
   *
   * @param text the same words as the proposals of the rules
   * @returns Claude's proposals, or why none
   */
  async askAi(text: string): Promise<AskAiResult> {
    if (this.#assistant === null) {
      return { status: 'not_configured' };
    }
    const index = this.#index();
    const items = this.#items(text, index);
    const proposed = new Set(this.#ruleProposals(items, index).flatMap((proposal) => proposal.items.map((item) => item.itemId)));
    const loose = items.filter((item) => !proposed.has(item.id) && (item.equivalenceGroupId ?? null) === null).slice(0, MAX_AI_ITEMS);
    const letters = new Map<string, string>();
    for (const item of loose) {
      if (!letters.has(item.supplierId)) {
        letters.set(item.supplierId, `P${letters.size + 1}`);
      }
    }
    if (letters.size < 2) {
      return { status: 'nothing_to_send' };
    }
    const response = await this.#assistant.group(
      loose.map((item) => ({
        id: item.id,
        supplier: letters.get(item.supplierId)!,
        description: item.description,
        purchase_unit: item.purchaseUnit,
        pieces_per_unit: String(Math.floor(item.piecesPerUnitMilli / 1000)),
      })),
    );
    if (response.status === 'failed') {
      return { status: 'failed', message: response.message };
    }
    const byId = new Map(loose.map((item) => [item.id, item]));
    const rejected = this.#rejectedPairs(items);
    const proposals: EquivalenceProposal[] = [];
    for (const group of response.groups) {
      const members = [...new Set(group.item_ids)].map((id) => byId.get(id)).filter((item): item is CatalogItem => item !== undefined);
      if (members.length < 2 || new Set(members.map((item) => item.supplierId)).size !== members.length) {
        continue;
      }
      const features = members.map((item) => extractFeatures(item.description, index));
      const vetoed = members.some((left, i) =>
        members.some((right, j) => j > i && (rejected.has(matchPairKey(left.id, right.id)) || conflictOf(features[i]!, features[j]!) !== null)),
      );
      if (vetoed) {
        continue;
      }
      proposals.push({
        items: members.map(toEquivalenceItem),
        score: null,
        confidence: group.confidence,
        origin: 'ai',
        reason: group.reason.slice(0, 300),
        groupId: null,
        groupName: null,
        suggestedName: shortestDescription(members),
      });
    }
    return { status: 'proposed', proposals, sentCount: loose.length };
  }

  /**
   * Approves a group, or adds items to one, in one transaction with its audit entry. A group holds one item per supplier
   * and never items tied to two different products of the store.
   *
   * @param request the items, the group to add them to or null for a new one, its name, and where the proposal came from
   * @param userId who approves it, the owner
   * @returns the group as it is now, or why nothing changed
   */
  approve(request: ApproveEquivalenceRequest, userId: string): ApproveEquivalenceResult {
    const items = request.itemIds.map((id) => this.#itemById.get(this.#tenantId, id) as unknown as ItemRow | undefined);
    if (items.some((row) => row === undefined)) {
      return { status: 'not_found' };
    }
    const chosen = (items as ItemRow[]).map(toCatalogItem);
    if (request.groupId !== null && this.#groupName.get(this.#tenantId, request.groupId) === undefined) {
      return { status: 'not_found' };
    }
    const current = request.groupId === null ? [] : this.#membersOf(request.groupId);
    const joining = chosen.filter((item) => item.equivalenceGroupId !== request.groupId || request.groupId === null);
    const all = [...current, ...joining.filter((item) => !current.some((member) => member.id === item.id))];
    if (all.length < 2 || joining.length === 0) {
      return { status: 'too_few' };
    }
    const seen = new Set<string>();
    for (const item of all) {
      if (seen.has(item.supplierId)) {
        return { status: 'same_supplier', supplierName: item.supplierName };
      }
      seen.add(item.supplierId);
    }
    if (new Set(all.map((item) => item.productId).filter((id) => id !== null)).size > 1) {
      return { status: 'different_products' };
    }
    const name = request.name.trim().slice(0, MAX_GROUP_NAME_LENGTH) || shortestDescription(all);
    const groupId = request.groupId ?? uuidV7();
    const now = new Date().toISOString();
    this.#store.transaction(() => {
      for (const item of joining) {
        this.#insertDecision.run(uuidV7(), this.#tenantId, 'join', groupId, item.supplierId, item.supplierCode, null, null, null, request.origin, request.score, request.reason.slice(0, 300) || null, userId, now);
      }
      const previousName = request.groupId === null ? undefined : (this.#groupName.get(this.#tenantId, groupId) as unknown as { name: string } | undefined)?.name;
      if (previousName !== name) {
        this.#insertDecision.run(uuidV7(), this.#tenantId, 'name', groupId, null, null, null, null, name, 'manual', null, null, userId, now);
      }
      this.#audit.record({
        userId,
        action: 'catalog_equivalence.approve',
        entity: 'catalog_equivalence',
        entityId: groupId,
        detail: `«${name}» (${request.origin}${request.score === null ? '' : `, ${request.score} points`}): ${joining.map((item) => `${item.supplierName} ${item.supplierCode}`).join(', ')}`,
      });
    });
    return { status: 'approved', group: this.#groupOf(groupId, name) };
  }

  /**
   * Marks every pair of the items of different suppliers as different products, so the matcher never proposes them again,
   * even after new lists.
   *
   * @param itemIds the items of the proposal the owner rejected
   * @param userId who rejects it, the owner
   * @returns that it was recorded
   */
  reject(itemIds: readonly string[], userId: string): { status: 'rejected' } {
    const items = itemIds
      .map((id) => this.#itemById.get(this.#tenantId, id) as unknown as ItemRow | undefined)
      .filter((row): row is ItemRow => row !== undefined)
      .map(toCatalogItem);
    const now = new Date().toISOString();
    this.#store.transaction(() => {
      for (const [i, left] of items.entries()) {
        for (const right of items.slice(i + 1)) {
          if (left.supplierId !== right.supplierId) {
            this.#insertDecision.run(uuidV7(), this.#tenantId, 'reject', null, left.supplierId, left.supplierCode, right.supplierId, right.supplierCode, null, 'manual', null, null, userId, now);
          }
        }
      }
      this.#audit.record({
        userId,
        action: 'catalog_equivalence.reject',
        entity: 'catalog_equivalence',
        entityId: items[0]?.id ?? 'none',
        detail: `Not the same product: ${items.map((item) => `${item.supplierName} ${item.supplierCode}`).join(', ')}`,
      });
    });
    return { status: 'rejected' };
  }

  /**
   * Lists the approved groups with the items they have in the current lists.
   *
   * @param text words of the name or of a description; empty lists every group
   * @returns the groups by name, each with its cheapest item per base unit
   */
  groups(text: string): EquivalenceGroup[] {
    const index = this.#index();
    const byGroup = new Map<string, CatalogItem[]>();
    for (const row of this.#groupItems.all(this.#tenantId) as unknown as ItemRow[]) {
      const item = withPiecesFromDescription(toCatalogItem(row), index);
      byGroup.set(item.equivalenceGroupId!, [...(byGroup.get(item.equivalenceGroupId!) ?? []), item]);
    }
    const wanted = normalizeText(text);
    return (this.#groupNames.all(this.#tenantId) as unknown as { group_id: string; name: string }[])
      .map(({ group_id: id, name }) => this.#describeGroup(id, name, byGroup.get(id) ?? []))
      .filter((group) => group.items.length > 0 || wanted === '')
      .filter((group) => wanted === '' || [group.name, ...group.items.map((item) => item.description)].some((words) => normalizeText(words).includes(wanted)));
  }

  /**
   * Takes an item out of its group, with its audit entry. The group keeps its other items and its name.
   *
   * @param request the group and the item
   * @param userId who does it, the owner
   * @returns whether the item was in that group
   */
  remove({ groupId, itemId }: RemoveFromEquivalenceRequest, userId: string): RemoveFromEquivalenceResult {
    const row = this.#itemById.get(this.#tenantId, itemId) as unknown as ItemRow | undefined;
    if (row === undefined || row.equivalence_group_id !== groupId) {
      return { status: 'not_found' };
    }
    this.#store.transaction(() => {
      this.#insertDecision.run(uuidV7(), this.#tenantId, 'leave', groupId, row.supplier_id, row.supplier_code, null, null, null, 'manual', null, null, userId, new Date().toISOString());
      this.#audit.record({
        userId,
        action: 'catalog_equivalence.remove',
        entity: 'catalog_equivalence',
        entityId: groupId,
        detail: `${row.supplier_name} ${row.supplier_code} (${row.description}) left «${row.equivalence_name ?? ''}»`,
      });
    });
    return { status: 'removed' };
  }

  /** @returns the words the owner added to the dictionary */
  synonyms(): OwnerSynonym[] {
    return this.#ownerSynonyms.all(this.#tenantId) as unknown as OwnerSynonym[];
  }

  /**
   * Adds a word to the dictionary of the matcher, or changes what it means, with its audit entry.
   *
   * @param synonym the word and what it means, such as «alta velocidad» and «hss»
   * @param userId who adds it, the owner
   * @returns whether it was added, or why not in Spanish
   */
  addSynonym({ term, canonical }: OwnerSynonym, userId: string): AddSynonymResult {
    const cleanTerm = normalizeText(term);
    const cleanCanonical = normalizeText(canonical);
    if (cleanTerm === '' || cleanCanonical === '' || cleanTerm.length > MAX_SYNONYM_LENGTH || cleanCanonical.length > MAX_SYNONYM_LENGTH) {
      return { status: 'invalid', message: `Escribe las dos palabras, de hasta ${MAX_SYNONYM_LENGTH} letras cada una.` };
    }
    if (cleanTerm === cleanCanonical) {
      return { status: 'invalid', message: 'Las dos palabras son iguales.' };
    }
    this.#store.transaction(() => {
      this.#upsertSynonym.run(this.#tenantId, cleanTerm, cleanCanonical, userId, new Date().toISOString());
      this.#audit.record({ userId, action: 'catalog_synonym.add', entity: 'catalog_synonym', entityId: cleanTerm, detail: `«${cleanTerm}» means «${cleanCanonical}»` });
    });
    return { status: 'added' };
  }

  /**
   * Takes a word out of the dictionary, with its audit entry.
   *
   * @param term the word as it was saved
   * @param userId who does it, the owner
   * @returns that it is gone
   */
  removeSynonym(term: string, userId: string): { status: 'removed' } {
    this.#store.transaction(() => {
      if (Number(this.#deleteSynonym.run(this.#tenantId, term).changes) > 0) {
        this.#audit.record({ userId, action: 'catalog_synonym.remove', entity: 'catalog_synonym', entityId: term, detail: `«${term}» removed from the dictionary` });
      }
    });
    return { status: 'removed' };
  }

  #index(): SynonymIndex {
    return buildSynonymIndex(this.synonyms());
  }

  #items(text: string, index: SynonymIndex): CatalogItem[] {
    if (text.trim() === '') {
      return (this.#allItems.all(this.#tenantId) as unknown as ItemRow[]).map(toCatalogItem);
    }
    const found = new Map<string, CatalogItem>();
    for (const words of [text, ...synonymSearchTexts(text, index)]) {
      const query = toPrefixQuery(words);
      if (query !== null) {
        for (const row of this.#searchItems.all(this.#tenantId, query) as unknown as ItemRow[]) {
          found.set(row.id, toCatalogItem(row));
        }
      }
    }
    return [...found.values()];
  }

  #rejectedPairs(items: readonly CatalogItem[]): Set<string> {
    const byKey = new Map(items.map((item) => [itemKey(item.supplierId, item.supplierCode), item.id]));
    const pairs = new Set<string>();
    for (const row of this.#rejections.all(this.#tenantId) as unknown as DecisionRow[]) {
      const left = byKey.get(itemKey(row.supplier_id, row.supplier_code));
      const right = byKey.get(itemKey(row.other_supplier_id, row.other_supplier_code));
      if (left !== undefined && right !== undefined) {
        pairs.add(matchPairKey(left, right));
      }
    }
    return pairs;
  }

  #ruleProposals(items: readonly CatalogItem[], index: SynonymIndex): EquivalenceProposal[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const matches = proposeMatches(
      items.map((item) => ({ id: item.id, supplierId: item.supplierId, description: item.description, productId: item.productId, groupId: item.equivalenceGroupId ?? null })),
      { index, rejectedPairs: this.#rejectedPairs(items) },
    );
    return matches.map((match) => {
      const members = match.itemIds.map((id) => withPiecesFromDescription(byId.get(id)!, index));
      const groupName = members.find((item) => item.equivalenceGroupId === match.groupId)?.equivalenceName ?? null;
      return {
        items: members.map(toEquivalenceItem),
        score: match.score,
        confidence: confidenceOf(match.score),
        origin: 'rules',
        reason: match.reason,
        groupId: match.groupId,
        groupName: match.groupId === null ? null : groupName,
        suggestedName: groupName ?? shortestDescription(members),
      };
    });
  }

  #membersOf(groupId: string): CatalogItem[] {
    return (this.#groupItems.all(this.#tenantId) as unknown as ItemRow[]).filter((row) => row.equivalence_group_id === groupId).map(toCatalogItem);
  }

  #groupOf(groupId: string, name: string): EquivalenceGroup {
    return this.#describeGroup(groupId, name, this.#membersOf(groupId).map((item) => withPiecesFromDescription(item, this.#index())));
  }

  #describeGroup(id: string, name: string, items: readonly CatalogItem[]): EquivalenceGroup {
    const cheapest = [...items].sort((left, right) => left.baseUnitCostE6 - right.baseUnitCostE6)[0];
    return { id, name, items: items.map(toEquivalenceItem), cheapestItemId: cheapest?.id ?? null };
  }
}
