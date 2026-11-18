import Link from 'next/link';
import { formatPrice } from '@/lib/catalog/decimal-text';
import { TAX_OPTIONS } from '@/lib/catalog/product-form';
import { UNIT_LABELS, type Product } from '@/lib/catalog/types';

interface ProductTableProps {
  products: readonly Product[];
}

function taxLabel(product: Product): string {
  const value = product.taxFactor === 'exempt' ? 'exempt' : `rate-${product.taxRateBp}`;
  return TAX_OPTIONS.find((option) => option.value === value)?.label ?? `${product.taxRateBp / 100}%`;
}

/**
 * One page of products. It renders on the server and only ever holds one page (50 rows), so 5,000 products in the
 * catalog cost the browser the same as 50.
 */
export function ProductTable({ products }: ProductTableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Código</th>
            <th scope="col">Unidad</th>
            <th scope="col" className="table__number">
              Precio
            </th>
            <th scope="col">IVA</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td>
                <Link href={`/catalog/${product.id}`} className="table__link">
                  {product.name}
                </Link>
                {!product.invoiceable && <span className="table__hint">Sin claves SAT</span>}
              </td>
              <td className="mono">
                {product.codes[0]?.code ?? '—'}
                {product.codes.length > 1 && <span className="table__hint"> +{product.codes.length - 1}</span>}
              </td>
              <td>{UNIT_LABELS[product.unit] ?? product.unit}</td>
              <td className="table__number">{formatPrice(product.unitPrice)}</td>
              <td>{taxLabel(product)}</td>
              <td>
                <span className={product.status === 'active' ? 'pill pill--ok' : 'pill'}>
                  {product.status === 'active' ? 'Activo' : 'Inactivo'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
