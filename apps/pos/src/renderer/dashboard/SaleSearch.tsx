import { formatCents } from '@pos-saas/money';
import { useRef, useState, type ReactElement } from 'react';

import type { SaleSummary } from '../../shared/register-tools';
import { Field, Message } from '../ui/form-parts';

const MAX_SEARCH_LENGTH = 60;
const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

interface SaleSearchProps {
  /** Finds completed sales by folio, product name or code. */
  readonly search: (text: string) => Promise<readonly SaleSummary[]>;
}

/**
 * The search bar of «Resumen»: finds any completed sale by its ticket folio, by the name of a product sold, or by its
 * code, on every date, and says which products of each sale matched.
 *
 * @param props.search the bridge that reads the sales
 * @returns the search bar and what it found
 */
export function SaleSearch({ search }: SaleSearchProps): ReactElement {
  const [text, setText] = useState('');
  const [sales, setSales] = useState<readonly SaleSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Each keystroke asks again; only the answer to the last one is shown.
  const latest = useRef(0);

  const look = (typed: string): void => {
    setText(typed);
    const ticket = latest.current + 1;
    latest.current = ticket;
    if (typed.trim() === '') {
      setSales(null);
      setMessage(null);
      return;
    }
    search(typed).then(
      (found) => {
        if (ticket === latest.current) {
          setSales(found);
          setMessage(null);
        }
      },
      () => {
        if (ticket === latest.current) {
          setMessage('No se pudieron leer las ventas. Intenta de nuevo.');
        }
      },
    );
  };

  return (
    <section className="sale-search" aria-label="Buscar ventas">
      <Field
        label="Buscar ticket, producto o código"
        value={text}
        onChange={look}
        maxLength={MAX_SEARCH_LENGTH}
        hint="Por ejemplo T1-000123, «cinta de aislar» o el código de barras. Busca en todas las fechas."
      />
      <Message text={message} />
      {sales !== null && sales.length === 0 && <p className="sale-empty-title">Ninguna venta tiene ese ticket, producto o código.</p>}
      {sales !== null && sales.length > 0 && (
        <div className="scroll-area sale-search-results">
          <table aria-label="Ventas encontradas">
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Fecha</th>
                <th scope="col">Cajero</th>
                <th scope="col">Productos que coinciden</th>
                <th scope="col" className="line-number">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.saleId}>
                  <td>{sale.folio}</td>
                  <td>{MOMENT.format(new Date(sale.completedAt))}</td>
                  <td>{sale.cashierName ?? '—'}</td>
                  <td>{sale.matchedProducts.length === 0 ? `${String(sale.lineCount)} producto(s)` : sale.matchedProducts.join(', ')}</td>
                  <td className="line-number">
                    {formatCents(sale.totalCents)}
                    {sale.refundedCents > 0 && <small> (devuelto {formatCents(sale.refundedCents)})</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
