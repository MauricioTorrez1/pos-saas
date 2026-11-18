import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeleteProductButton } from '@/components/catalog/delete-product-button';
import { PriceForm } from '@/components/catalog/price-form';
import { ProductForm } from '@/components/catalog/product-form';
import { failureMessage } from '@/lib/catalog/core-api';
import { formatPrice, formatQuantity } from '@/lib/catalog/decimal-text';
import { productFormFromProduct } from '@/lib/catalog/product-form';
import { UNIT_LABELS } from '@/lib/catalog/types';
import { getCoreApi, getMe } from '@/lib/server';
import { changePriceAction, deleteProductAction, updateProductAction } from '../actions';

export const metadata: Metadata = { title: 'Editar producto' };
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProductPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string }>;
}

/** Edits one product. The price has its own form, shown only to the owner. */
export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const { id } = await params;
  const { created, saved } = await searchParams;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }
  const [api, me] = await Promise.all([getCoreApi(), getMe()]);
  const result = await api.getProduct(id);
  if (!result.ok && result.status === 404) {
    notFound();
  }
  if (!result.ok) {
    return (
      <p className="notice notice--danger" role="alert">
        {failureMessage(result, 'No se pudo abrir el producto.')}
      </p>
    );
  }
  const product = result.data;
  const isOwner = me.status === 'ok' && me.role === 'owner';

  return (
    <>
      <div className="shell__heading shell__heading--split">
        <div>
          <p className="breadcrumb">
            <Link href="/catalog">Productos</Link> /
          </p>
          <h1>{product.name}</h1>
          <p>
            {formatPrice(product.unitPrice)} por {UNIT_LABELS[product.unit]?.toLowerCase() ?? product.unit}
            {product.presentations.length > 0 &&
              ` · ${product.presentations.map((p) => `${p.name} de ${formatQuantity(p.baseQuantity)}`).join(', ')}`}
          </p>
        </div>
        <DeleteProductButton action={deleteProductAction.bind(null, product.id)} productName={product.name} />
      </div>

      {created && (
        <p className="notice notice--ok" role="status">
          Producto creado. Las cajas lo reciben en su siguiente sincronización.
        </p>
      )}
      {saved && !created && (
        <p className="notice notice--ok" role="status">
          Cambios guardados. Las cajas los reciben en su siguiente sincronización.
        </p>
      )}

      <div className="stack stack--wide">
        {isOwner && (
          <section className="panel stack" aria-labelledby="price-title">
            <h2 id="price-title">Precio</h2>
            <PriceForm action={changePriceAction.bind(null, product.id)} currentPrice={product.unitPrice} />
          </section>
        )}
        <section className="panel" aria-labelledby="data-title">
          <h2 id="data-title" className="panel__label">
            Datos del producto
          </h2>
          <ProductForm
            key={product.updatedAt}
            action={updateProductAction.bind(null, product.id)}
            initial={productFormFromProduct(product)}
            mode="edit"
            showPrice={false}
          />
        </section>
      </div>
    </>
  );
}
