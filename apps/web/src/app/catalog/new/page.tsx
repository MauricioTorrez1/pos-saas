import type { Metadata } from 'next';
import { ProductForm } from '@/components/catalog/product-form';
import { productFormFromProduct } from '@/lib/catalog/product-form';
import { getMe } from '@/lib/server';
import { uuidv7 } from '@/lib/uuid7';
import { createProductAction } from '../actions';

export const metadata: Metadata = { title: 'Nuevo producto' };
export const dynamic = 'force-dynamic';

/**
 * Creates a product. The owner sets the price here; the manager creates it without one (the core allows a price
 * only to who holds `price.change`), and the owner adds it later.
 */
export default async function NewProductPage() {
  const me = await getMe();
  const mayPrice = me.status === 'ok' && me.role === 'owner';
  return (
    <>
      <div className="shell__heading">
        <h1>Nuevo producto</h1>
        <p>{mayPrice ? 'Solo el nombre y la unidad son obligatorios.' : 'El dueño pone el precio después.'}</p>
      </div>
      <section className="panel">
        <ProductForm
          action={createProductAction}
          initial={productFormFromProduct(null)}
          mode="create"
          showPrice={mayPrice}
          idempotencyKey={uuidv7()}
        />
      </section>
    </>
  );
}
