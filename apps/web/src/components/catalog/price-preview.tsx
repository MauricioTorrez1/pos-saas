import { formatPrice } from '@/lib/catalog/decimal-text';
import type { PriceChangeResult } from '@/lib/catalog/types';

interface PricePreviewProps {
  result: PriceChangeResult;
}

/** The products a bulk change would touch, with the price before and after. The core sends the first 500. */
export function PricePreview({ result }: PricePreviewProps) {
  if (result.count === 0) {
    return <p className="notice">Ningún producto con precio coincide con la búsqueda.</p>;
  }
  return (
    <div className="stack">
      <p className="panel__value" data-testid="preview-count">
        {result.count.toLocaleString('es-MX')} {result.count === 1 ? 'producto cambia' : 'productos cambian'}
      </p>
      <div className="table-wrap table-wrap--short">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col" className="table__number">
                Precio actual
              </th>
              <th scope="col" className="table__number">
                Precio nuevo
              </th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line) => (
              <tr key={line.productId}>
                <td>{line.name}</td>
                <td className="table__number">{formatPrice(line.currentPrice)}</td>
                <td className="table__number table__strong">{formatPrice(line.newPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.count > result.lines.length && (
        <p className="panel__detail">
          Se muestran los primeros {result.lines.length} por nombre; el cambio se aplica a los {result.count}.
        </p>
      )}
    </div>
  );
}
