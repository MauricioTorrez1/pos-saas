/**
 * The titles the import understands, as the owner should write them in the first row of the file. The screen shows
 * this list before the file is chosen, so a file from another point of sale is fixed once and read correctly.
 */
export const IMPORT_COLUMN_GUIDE: readonly { readonly title: string; readonly required: boolean; readonly note: string }[] = [
  { title: 'Código del producto', required: true, note: 'El código de barras o la clave. No se puede repetir.' },
  { title: 'Nombre del producto', required: true, note: 'Como quieres que salga en el ticket.' },
  { title: 'Precio de venta', required: true, note: 'Con IVA incluido, por ejemplo 135.50.' },
  { title: 'Costo con IVA', required: false, note: 'Lo que pagas por unidad con IVA. De aquí se calcula el costo sin IVA.' },
  { title: 'Costo sin IVA', required: false, note: 'Si viene, se usa tal cual y manda sobre el costo con IVA.' },
  { title: 'Existencias', required: false, note: 'Lo que hay en el estante. Piezas enteras; kilos, metros y litros con hasta 3 decimales.' },
  { title: 'Unidad', required: false, note: 'Pieza, kilo, metro o litro. Vacío es pieza.' },
  { title: 'IVA', required: false, note: '16, 8, 0 o «exento». Vacío es 16.' },
];
