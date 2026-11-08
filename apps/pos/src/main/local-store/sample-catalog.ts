import { parseUnitPriceE4, type TaxFactor, type Unit } from '@pos-saas/money';

import { uuidV7 } from '../uuid-v7';
import type { LocalStore } from './local-store';

/** Codes that start with 2 are reserved for use inside a store, so they never match a real product. */
const FIRST_SAMPLE_CODE_BODY = 200_000_000_010;
const CODE_STEP = 10;
const STANDARD_RATE_BP = 1600;

interface SampleProduct {
  readonly name: string;
  readonly unit: Unit;
  readonly price: string;
  readonly factor?: TaxFactor;
  readonly rateBp?: number;
}

/** What the register sells until it receives the real catalog (ADR 0019). */
const SAMPLE_PRODUCTS: readonly SampleProduct[] = [
  { name: 'Martillo uña curva 16 oz', unit: 'piece', price: '116.00' },
  { name: 'Desarmador plano 1/4"', unit: 'piece', price: '58.00' },
  { name: 'Pinzas de electricista 8"', unit: 'piece', price: '189.50' },
  { name: 'Flexómetro 5 m', unit: 'piece', price: '95.00' },
  { name: 'Llave perica 10"', unit: 'piece', price: '165.00' },
  { name: 'Segueta bimetálica 12"', unit: 'piece', price: '32.00' },
  { name: 'Brocha de cerda 2"', unit: 'piece', price: '38.00' },
  { name: 'Rodillo para pintar 9"', unit: 'piece', price: '89.00' },
  { name: 'Tornillo para madera 1 1/2"', unit: 'piece', price: '1.00' },
  { name: 'Taquete de plástico 1/4"', unit: 'piece', price: '0.50' },
  { name: 'Clavo estándar 2 1/2"', unit: 'kilogram', price: '45.00' },
  { name: 'Alambre recocido', unit: 'kilogram', price: '38.00' },
  { name: 'Cable THW calibre 12', unit: 'meter', price: '12.50' },
  { name: 'Cable dúplex calibre 14', unit: 'meter', price: '16.80' },
  { name: 'Piola #4', unit: 'meter', price: '18.90' },
  { name: 'Manguera reforzada 1/2"', unit: 'meter', price: '22.00' },
  { name: 'Cinta de aislar negra 18 m', unit: 'piece', price: '24.50' },
  { name: 'Foco LED 9 W luz blanca', unit: 'piece', price: '35.00' },
  { name: 'Contacto doble con tierra', unit: 'piece', price: '42.00' },
  { name: 'Apagador sencillo', unit: 'piece', price: '38.00' },
  { name: 'Llave de paso 1/2"', unit: 'piece', price: '120.00' },
  { name: 'Cinta de teflón 1/2"', unit: 'piece', price: '12.00' },
  { name: 'Codo de cobre 1/2"', unit: 'piece', price: '14.50' },
  { name: 'Pintura vinílica blanca 4 L', unit: 'piece', price: '420.00' },
  { name: 'Esmalte negro brillante 1 L', unit: 'piece', price: '165.00' },
  { name: 'Impermeabilizante acrílico 19 L', unit: 'piece', price: '1390.00' },
  { name: 'Thinner estándar', unit: 'liter', price: '42.00' },
  { name: 'Aguarrás', unit: 'liter', price: '55.00' },
  { name: 'Silicón transparente 280 ml', unit: 'piece', price: '72.00' },
  { name: 'Pegamento blanco 1 kg', unit: 'piece', price: '68.00' },
  { name: 'Lija de agua grano 120', unit: 'piece', price: '9.00' },
  { name: 'Semilla de pasto 500 g', unit: 'piece', price: '85.00', rateBp: 0 },
  { name: 'Producto exento de prueba', unit: 'piece', price: '35.00', factor: 'exempt', rateBp: 0 },
];

/**
 * Adds the check digit of EAN-13, so a real scanner accepts a printed sample code.
 *
 * @param body the first 12 digits
 * @returns the full 13-digit code
 */
function withEanCheckDigit(body: string): string {
  const weightedSum = [...body].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (weightedSum % 10)) % 10}`;
}

/**
 * Names the barcode of a sample product.
 *
 * @param position where the product is in the sample list, from 0
 * @returns a valid EAN-13 code
 */
export function sampleBarcode(position: number): string {
  return withEanCheckDigit(String(FIRST_SAMPLE_CODE_BODY + position * CODE_STEP));
}

/**
 * Fills an empty catalog with sample products, marked with `is_sample` so the real catalog can replace them. A
 * catalog that already has products is left alone.
 *
 * @param store the open local database
 * @param tenantId the business that receives the products
 */
export function seedSampleCatalogIfEmpty(store: LocalStore, tenantId: string): void {
  store.transaction((connection) => {
    const { products } = connection.prepare('SELECT count(*) AS products FROM product WHERE tenant_id = ?').get(tenantId) as {
      products: number;
    };
    if (products > 0) {
      return;
    }
    const insertProduct = connection.prepare(`
      INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, is_sample)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertBarcode = connection.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)');
    SAMPLE_PRODUCTS.forEach(({ name, unit, price, factor = 'rate', rateBp = STANDARD_RATE_BP }, position) => {
      const id = uuidV7();
      insertProduct.run(id, tenantId, name, unit, parseUnitPriceE4(price), factor, rateBp);
      insertBarcode.run(tenantId, sampleBarcode(position), id);
    });
  });
}
