import { useEffect, useState, type ReactElement } from 'react';

import type {
  ApproveEquivalenceResult,
  EquivalenceApi,
  EquivalenceGroup,
  EquivalenceItem,
  EquivalenceProposal,
  OwnerSynonym,
} from '../../shared/catalog-equivalence';
import { formatUnitCost } from '../../shared/product-admin';
import { milliText } from '../../shared/supplier-catalog';
import { Field, Message, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';

type Tab = 'proposals' | 'groups' | 'synonyms';

/** What the owner changed of one proposal before approving it. */
interface ProposalDraft {
  readonly excluded: ReadonlySet<string>;
  readonly name: string;
}

interface EquivalentProductsProps {
  readonly api: EquivalenceApi;
  readonly onBack: () => void;
}

function keyOf(proposal: EquivalenceProposal): string {
  return proposal.items.map((item) => item.itemId).join('|');
}

function headingOf(proposal: EquivalenceProposal, position: number): string {
  const how = proposal.origin === 'ai' ? 'Propuesta de la IA' : proposal.confidence === 'high' ? 'Muy probable' : 'Probable';
  const target = proposal.groupName === null ? '' : ` · se agrega a «${proposal.groupName}»`;
  return `${position}. ${how}${proposal.score === null ? '' : ` (${proposal.score} de 100)`}${target}`;
}

function piecesText(item: EquivalenceItem): string {
  return item.piecesPerUnitMilli === 1000 ? (item.purchaseUnit ?? 'Pieza') : `${item.purchaseUnit ?? 'Presentación'} de ${milliText(item.piecesPerUnitMilli)}`;
}

function describeApproval(result: Exclude<ApproveEquivalenceResult, { status: 'approved' }>): string {
  switch (result.status) {
    case 'not_found':
      return 'Una lista cambió mientras revisabas. Vuelve a buscar.';
    case 'same_supplier':
      return `Un grupo lleva un solo artículo de cada proveedor, y hay dos de ${result.supplierName}. Quita uno.`;
    case 'different_products':
      return 'Esos artículos están ligados a productos distintos de la tienda; no pueden ser el mismo.';
    case 'too_few':
      return 'Deja al menos dos artículos de proveedores distintos.';
  }
}

/** The items of a proposal or a group, with their price per base unit. */
function ItemsTable({ label, items, cheapestId, selectable }: {
  readonly label: string;
  readonly items: readonly EquivalenceItem[];
  readonly cheapestId: string | null;
  readonly selectable?: { readonly excluded: ReadonlySet<string>; readonly toggle: (itemId: string) => void; readonly remove?: never } | { readonly remove: (itemId: string) => void; readonly excluded?: never; readonly toggle?: never };
}): ReactElement {
  return (
    <table className="order-lines" aria-label={label}>
      <thead>
        <tr>
          {selectable?.toggle !== undefined && <th scope="col">Incluir</th>}
          <th scope="col">Proveedor</th>
          <th scope="col">Código</th>
          <th scope="col">Descripción</th>
          <th scope="col">Presentación</th>
          <th scope="col">Precio por unidad</th>
          {selectable?.remove !== undefined && <th scope="col"></th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.itemId} className={item.itemId === cheapestId && items.length > 1 ? 'price-cheapest' : ''}>
            {selectable?.toggle !== undefined && (
              <td>
                <input type="checkbox" aria-label={`Incluir ${item.supplierCode}`} checked={!selectable.excluded.has(item.itemId)} onChange={() => selectable.toggle(item.itemId)} />
              </td>
            )}
            <td>{item.supplierName}</td>
            <td>{item.supplierCode}</td>
            <td>
              {item.description}
              {item.productName === null ? '' : ` · ligado a ${item.productName}`}
            </td>
            <td>{piecesText(item)}</td>
            <td className="order-amount">{formatUnitCost(item.baseUnitCostE6)}</td>
            {selectable?.remove !== undefined && (
              <td>
                <button type="button" className="button" tabIndex={-1} onClick={() => selectable.remove(item.itemId)}>
                  Quitar {item.supplierCode}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cheapestOf(items: readonly EquivalenceItem[]): string | null {
  return [...items].sort((left, right) => left.baseUnitCostE6 - right.baseUnitCostE6)[0]?.itemId ?? null;
}

/**
 * Equivalent products across supplier catalogs (E1-63): the register proposes which items of different suppliers are the
 * same product even when they are written differently («HSS» and «alta velocidad», 1/4" and 6.35 mm), and the owner
 * approves, edits or rejects each proposal. Approved groups are compared side by side in «Comparar precios» and are
 * remembered on the next lists. Claude can be asked for what the rules could not group, only with internet and when the
 * analytics service is configured. The owner can teach the register new words. Only the owner opens it.
 *
 * @param props.api bridge of the equivalent products
 * @param props.onBack called to go back to the suppliers
 * @returns the screen, to put inside a dialog
 */
export function EquivalentProducts({ api, onBack }: EquivalentProductsProps): ReactElement {
  const [tab, setTab] = useState<Tab>('proposals');
  const [text, setText] = useState('');
  const [proposals, setProposals] = useState<readonly EquivalenceProposal[] | null>(null);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ProposalDraft>>(new Map());
  const [groups, setGroups] = useState<readonly EquivalenceGroup[] | null>(null);
  const [synonyms, setSynonyms] = useState<readonly OwnerSynonym[]>([]);
  const [term, setTerm] = useState('');
  const [meaning, setMeaning] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  useEffect(() => {
    void api.aiAvailable().then(setAiAvailable);
  }, [api]);

  const show = (found: readonly EquivalenceProposal[], append: boolean): void => {
    setProposals((previous) => (append ? [...(previous ?? []), ...found] : found));
    setDrafts((previous) => {
      const next = new Map(append ? previous : []);
      for (const proposal of found) {
        next.set(keyOf(proposal), { excluded: new Set(), name: proposal.suggestedName });
      }
      return next;
    });
  };

  const propose = (): void => {
    setTab('proposals');
    setNote(null);
    run(async () => {
      const result = await api.proposeEquivalences(text);
      show(result.proposals, false);
      setNote(`Revisé ${result.examinedCount} artículos de las listas.`);
    });
  };

  const askAi = (): void => {
    setTab('proposals');
    setNote(null);
    run(async () => {
      const result = await api.askAiForEquivalences(text);
      if (result.status === 'proposed') {
        show(result.proposals, true);
        setNote(`La IA revisó ${result.sentCount} artículos que las reglas no agruparon y propuso ${result.proposals.length} grupos. Revísalos antes de aprobar.`);
      } else if (result.status === 'nothing_to_send') {
        setNote('No quedan artículos de dos proveedores distintos sin agrupar.');
      } else if (result.status === 'not_configured') {
        setMessage('La ayuda de IA no está configurada en esta caja.');
      } else {
        setMessage(result.message);
      }
    });
  };

  const loadGroups = (): void => {
    setTab('groups');
    setNote(null);
    run(async () => setGroups(await api.listEquivalenceGroups(text)));
  };

  const loadSynonyms = (): void => {
    setTab('synonyms');
    setNote(null);
    run(async () => setSynonyms(await api.listSynonyms()));
  };

  const draftOf = (proposal: EquivalenceProposal): ProposalDraft => drafts.get(keyOf(proposal)) ?? { excluded: new Set(), name: proposal.suggestedName };
  const changeDraft = (proposal: EquivalenceProposal, patch: Partial<ProposalDraft>): void =>
    setDrafts((previous) => new Map(previous).set(keyOf(proposal), { ...draftOf(proposal), ...patch }));
  const dropProposal = (proposal: EquivalenceProposal): void => setProposals((previous) => (previous ?? []).filter((other) => keyOf(other) !== keyOf(proposal)));

  const approve = (proposal: EquivalenceProposal): void => {
    const draft = draftOf(proposal);
    const itemIds = proposal.items.map((item) => item.itemId).filter((id) => !draft.excluded.has(id));
    run(async () => {
      const result = await api.approveEquivalence({ itemIds, groupId: proposal.groupId, name: draft.name, origin: draft.excluded.size === 0 ? proposal.origin : 'manual', score: proposal.score, reason: proposal.reason });
      if (result.status === 'approved') {
        dropProposal(proposal);
        setMessage(null);
        setNote(`Listo. «${result.group.name}» ya se compara junto en «Comparar precios» y se recordará con las próximas listas.`);
      } else {
        setMessage(describeApproval(result));
      }
    });
  };

  const reject = (proposal: EquivalenceProposal): void =>
    run(async () => {
      await api.rejectEquivalence(proposal.items.map((item) => item.itemId));
      dropProposal(proposal);
      setMessage(null);
      setNote('Anotado: no son el mismo producto y no te los volveré a proponer.');
    });

  const removeMember = (group: EquivalenceGroup, itemId: string): void =>
    run(async () => {
      const result = await api.removeFromEquivalence({ groupId: group.id, itemId });
      if (result.status === 'not_found') {
        setMessage('Ese artículo ya no está en el grupo.');
      }
      setGroups(await api.listEquivalenceGroups(text));
    });

  const addSynonym = (): void =>
    run(async () => {
      const result = await api.addSynonym({ term, canonical: meaning });
      if (result.status === 'invalid') {
        setMessage(result.message);
        return;
      }
      setTerm('');
      setMeaning('');
      setMessage(null);
      setNote('Listo. Las próximas búsquedas ya usan esa palabra.');
      setSynonyms(await api.listSynonyms());
    });

  const removeSynonym = (word: string): void =>
    run(async () => {
      await api.removeSynonym(word);
      setSynonyms(await api.listSynonyms());
    });

  useWindowKeys({ F3: loadGroups, F4: aiAvailable ? askAi : undefined, F5: loadSynonyms, Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="order-title">Productos equivalentes</h2>
      <p>
        Encuentro el mismo producto en las listas de distintos proveedores aunque lo escriban diferente o con otro código, como «HSS» y «alta velocidad» o 1/4&quot; y 6.35 mm.
        Tú decides: lo que apruebes se compara junto en «Comparar precios».
      </p>
      <Field label="Buscar en las listas" value={text} onChange={setText} autoFocus maxLength={100} onEnter={propose} hint="Déjalo vacío para revisar todas las listas." />

      {tab === 'proposals' && proposals !== null && proposals.length === 0 && <p>No encontré productos equivalentes nuevos.{aiAvailable ? ' Puedes pedir ayuda a la IA.' : ''}</p>}
      {tab === 'proposals' &&
        proposals?.map((proposal, position) => {
          const draft = draftOf(proposal);
          return (
            <section key={keyOf(proposal)} className="comparison-group" aria-label={`Propuesta ${position + 1}`}>
              <h3>{headingOf(proposal, position + 1)}</h3>
              <p className="quantity-price">{proposal.reason}</p>
              <ItemsTable
                label={`Artículos de la propuesta ${position + 1}`}
                items={proposal.items}
                cheapestId={cheapestOf(proposal.items.filter((item) => !draft.excluded.has(item.itemId)))}
                selectable={{
                  excluded: draft.excluded,
                  toggle: (itemId) => {
                    const excluded = new Set(draft.excluded);
                    if (!excluded.delete(itemId)) {
                      excluded.add(itemId);
                    }
                    changeDraft(proposal, { excluded });
                  },
                }}
              />
              {proposal.groupId === null && (
                <Field label={`Nombre del grupo ${position + 1}`} value={draft.name} onChange={(name) => changeDraft(proposal, { name })} maxLength={80} />
              )}
              <div className="payment-actions">
                <button type="button" className="button" disabled={isBusy} onClick={() => reject(proposal)}>
                  No son iguales
                </button>
                <button type="button" className="button button-primary" disabled={isBusy} onClick={() => approve(proposal)}>
                  Aprobar propuesta {position + 1}
                </button>
              </div>
            </section>
          );
        })}

      {tab === 'groups' && groups !== null && groups.length === 0 && <p>Todavía no hay grupos aprobados.</p>}
      {tab === 'groups' &&
        groups?.map((group) => (
          <section key={group.id} className="comparison-group" aria-label={group.name}>
            <h3>{group.name}</h3>
            {group.items.length === 0 ? (
              <p>Ninguna lista actual trae sus artículos.</p>
            ) : (
              <ItemsTable label={`Artículos de ${group.name}`} items={group.items} cheapestId={group.cheapestItemId} selectable={{ remove: (itemId) => removeMember(group, itemId) }} />
            )}
          </section>
        ))}

      {tab === 'synonyms' && (
        <section aria-label="Sinónimos">
          <h3>Palabras que significan lo mismo</h3>
          <p>Ya conozco las de ferretería más comunes (HSS = alta velocidad, galv = galvanizado, inox = inoxidable…). Agrega las de tus proveedores.</p>
          {synonyms.length > 0 && (
            <ul aria-label="Palabras agregadas">
              {synonyms.map((synonym) => (
                <li key={synonym.term}>
                  «{synonym.term}» = «{synonym.canonical}»{' '}
                  <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => removeSynonym(synonym.term)}>
                    Quitar {synonym.term}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Palabra" value={term} onChange={setTerm} maxLength={60} hint="Como la escribe un proveedor, por ejemplo «chalupa»." />
          <Field label="Significa" value={meaning} onChange={setMeaning} maxLength={60} onEnter={addSynonym} hint="Como la escribe otro, por ejemplo «caja de registro»." />
          <button type="button" className="button" disabled={isBusy} onClick={addSynonym}>
            Agregar palabra
          </button>
        </section>
      )}

      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={propose}>
          Buscar equivalentes <kbd>Enter</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={loadGroups}>
          Grupos aprobados <kbd>F3</kbd>
        </button>
        {aiAvailable && (
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={askAi}>
            Pedir ayuda a la IA <kbd>F4</kbd>
          </button>
        )}
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={loadSynonyms}>
          Sinónimos <kbd>F5</kbd>
        </button>
      </div>
    </>
  );
}
