/** Equivalent products across supplier catalogs (E1-63, ADR 0079): what the screen and the main process exchange. */

/** Who proposed a group: the rules of the register, Claude through the analytics service, or the owner by hand. */
export type EquivalenceOrigin = 'rules' | 'ai' | 'manual';

/** How sure a proposal is, as the screen shows it. */
export type EquivalenceConfidence = 'high' | 'medium' | 'low';

/** An item of a supplier's list as the screen of equivalent products shows it. */
export interface EquivalenceItem {
  readonly itemId: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierCode: string;
  readonly description: string;
  readonly purchaseUnit: string | null;
  readonly piecesPerUnitMilli: number;
  /** The cost of one base unit before VAT, in millionths of a peso. */
  readonly baseUnitCostE6: number;
  readonly productName: string | null;
}

/** Items of different suppliers that look like the same product, waiting for the owner. */
export interface EquivalenceProposal {
  readonly items: readonly EquivalenceItem[];
  /** From 0 to 100 for the rules; null when Claude proposed it. */
  readonly score: number | null;
  readonly confidence: EquivalenceConfidence;
  readonly origin: Exclude<EquivalenceOrigin, 'manual'>;
  /** Why, in Spanish. */
  readonly reason: string;
  /** The approved group it adds to, if any, and its name. */
  readonly groupId: string | null;
  readonly groupName: string | null;
  /** A name for the new group: the shortest description. */
  readonly suggestedName: string;
}

/** An approved group of equivalent products, with the cheapest item per base unit. */
export interface EquivalenceGroup {
  readonly id: string;
  readonly name: string;
  readonly items: readonly EquivalenceItem[];
  /** Null when the group has no items in the current lists. */
  readonly cheapestItemId: string | null;
}

export interface ProposeEquivalencesResult {
  readonly proposals: readonly EquivalenceProposal[];
  /** How many items of the lists were looked at. */
  readonly examinedCount: number;
}

export type AskAiResult =
  | { readonly status: 'proposed'; readonly proposals: readonly EquivalenceProposal[]; readonly sentCount: number }
  /** The register has no address or token of the analytics service. */
  | { readonly status: 'not_configured' }
  /** Every item is already grouped or proposed, or they are all of one supplier. */
  | { readonly status: 'nothing_to_send' }
  | { readonly status: 'failed'; readonly message: string };

/** What the owner approves: the items, the group they join (or null for a new one), and its name. */
export interface ApproveEquivalenceRequest {
  readonly itemIds: readonly string[];
  readonly groupId: string | null;
  readonly name: string;
  readonly origin: EquivalenceOrigin;
  readonly score: number | null;
  readonly reason: string;
}

export type ApproveEquivalenceResult =
  | { readonly status: 'approved'; readonly group: EquivalenceGroup }
  | { readonly status: 'not_found' }
  /** A group holds one item per supplier. */
  | { readonly status: 'same_supplier'; readonly supplierName: string }
  /** The items are tied to different products of the store. */
  | { readonly status: 'different_products' }
  | { readonly status: 'too_few' };

export interface RemoveFromEquivalenceRequest {
  readonly groupId: string;
  readonly itemId: string;
}

export type RemoveFromEquivalenceResult = { readonly status: 'removed' } | { readonly status: 'not_found' };

/** A word the owner added to the dictionary: «alta velocidad» means «hss». */
export interface OwnerSynonym {
  readonly term: string;
  readonly canonical: string;
}

export type AddSynonymResult = { readonly status: 'added' } | { readonly status: 'invalid'; readonly message: string };

/** The screen of equivalent products. Every channel is for the owner, because the lists carry the costs of the business. */
export interface EquivalenceApi {
  /** Proposes groups with the rules of the register, without internet. Empty words look at every list. */
  proposeEquivalences(text: string): Promise<ProposeEquivalencesResult>;
  /** Sends what the rules could not group to Claude through the analytics service; never required. */
  askAiForEquivalences(text: string): Promise<AskAiResult>;
  /** Whether the analytics service is configured, so the screen offers the button. */
  aiAvailable(): Promise<boolean>;
  approveEquivalence(request: ApproveEquivalenceRequest): Promise<ApproveEquivalenceResult>;
  /** Marks every pair of the items as different products, so they are not proposed again. */
  rejectEquivalence(itemIds: readonly string[]): Promise<{ readonly status: 'rejected' }>;
  listEquivalenceGroups(text: string): Promise<EquivalenceGroup[]>;
  removeFromEquivalence(request: RemoveFromEquivalenceRequest): Promise<RemoveFromEquivalenceResult>;
  listSynonyms(): Promise<OwnerSynonym[]>;
  addSynonym(synonym: OwnerSynonym): Promise<AddSynonymResult>;
  removeSynonym(term: string): Promise<{ readonly status: 'removed' }>;
}

export const EQUIVALENCE_CHANNELS = {
  proposeEquivalences: 'catalog-equivalence:propose',
  askAiForEquivalences: 'catalog-equivalence:ask-ai',
  aiAvailable: 'catalog-equivalence:ai-available',
  approveEquivalence: 'catalog-equivalence:approve',
  rejectEquivalence: 'catalog-equivalence:reject',
  listEquivalenceGroups: 'catalog-equivalence:groups',
  removeFromEquivalence: 'catalog-equivalence:remove',
  listSynonyms: 'catalog-equivalence:synonyms',
  addSynonym: 'catalog-equivalence:add-synonym',
  removeSynonym: 'catalog-equivalence:remove-synonym',
} as const;

/** The most items one approval may name. */
export const MAX_GROUP_ITEMS = 50;
/** The longest name of a group. */
export const MAX_GROUP_NAME_LENGTH = 80;
/** The longest word of the dictionary. */
export const MAX_SYNONYM_LENGTH = 60;
