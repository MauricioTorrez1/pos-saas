'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  approveRow,
  ISSUE_LABELS,
  priceListCsv,
  priceListFileName,
  toReviewRow,
  type ApprovedRow,
  type ProposedRow,
  type ReviewRow,
} from '@/lib/paper-catalog/rows';

interface Photo {
  id: string;
  name: string;
  previewUrl: string;
  isPdf: boolean;
  status: 'reading' | 'ready' | 'failed';
  error: string | null;
  vatStatement: string;
  rows: ReviewRow[];
}

const MAX_EDGE_PX = 2000;
const PDF_TYPE = 'application/pdf';
const VAT_NOTES: Record<string, string> = {
  includes_vat: 'La hoja dice que sus precios incluyen IVA: quítaselo antes de aprobar.',
  not_stated: 'La hoja no dice si sus precios incluyen IVA. Confírmalo con el proveedor.',
};

/**
 * Makes a phone photo small enough (a PDF goes as it is) for the reader (under 5 MB) by redrawing it at most 2000 px on its long side.
 * Where the browser cannot redraw it, the original goes as it is and the service decides.
 */
async function shrinkPhoto(file: File): Promise<Blob> {
  if (file.type === PDF_TYPE) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 4_000_000) {
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

async function readPhoto(file: File): Promise<{ rows: ProposedRow[]; vatStatement: string } | { error: string }> {
  const body = await shrinkPhoto(file);
  try {
    const response = await fetch('/catalog/paper/read', {
      method: 'POST',
      headers: { 'Content-Type': body.type || file.type },
      body,
    });
    const answer = (await response.json().catch(() => ({}))) as {
      rows?: ProposedRow[];
      vatStatement?: string;
      message?: string;
    };
    if (!response.ok || !Array.isArray(answer.rows)) {
      return { error: answer.message ?? 'No se pudo leer la foto. Intenta de nuevo.' };
    }
    return { rows: answer.rows, vatStatement: answer.vatStatement ?? 'not_stated' };
  } catch {
    return { error: 'No hay conexión con el panel. Intenta de nuevo.' };
  }
}

function download(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Review of a photographed supplier catalog: each photo next to the rows Claude proposed. Doubtful rows are yellow;
 * the owner edits, deletes or approves each one, and only approved rows go to the CSV. Everything stays in this page's
 * memory: closing it forgets the photos and the rows (ADR 0069).
 */
export function PaperReview({ configured }: { configured: boolean }) {
  const [supplier, setSupplier] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const approved = useMemo(() => {
    const result: ApprovedRow[] = [];
    for (const photo of photos) {
      for (const row of photo.rows) {
        const checked = row.approved ? approveRow(row) : null;
        if (checked && 'row' in checked) {
          result.push(checked.row);
        }
      }
    }
    return result;
  }, [photos]);

  const pending = photos.some((photo) => photo.rows.some((row) => !row.approved));

  useEffect(() => {
    if (photos.length === 0) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [photos.length]);

  function updatePhoto(id: string, change: (photo: Photo) => Photo) {
    setPhotos((current) => current.map((photo) => (photo.id === id ? change(photo) : photo)));
  }

  function updateRow(photoId: string, rowId: string, patch: Partial<ReviewRow>) {
    updatePhoto(photoId, (photo) => ({
      ...photo,
      rows: photo.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    for (const file of files) {
      const id = crypto.randomUUID();
      setPhotos((current) => [
        ...current,
        { id, name: file.name, previewUrl: URL.createObjectURL(file), isPdf: file.type === PDF_TYPE, status: 'reading', error: null, vatStatement: '', rows: [] },
      ]);
      const result = await readPhoto(file);
      updatePhoto(id, (photo) =>
        'error' in result
          ? { ...photo, status: 'failed', error: result.error }
          : {
              ...photo,
              status: 'ready',
              vatStatement: result.vatStatement,
              rows: result.rows.map((row, index) => toReviewRow(row, `${id}-${index}`)),
            },
      );
    }
  }

  function approve(photoId: string, row: ReviewRow) {
    const checked = approveRow(row);
    setRowErrors((current) => ({ ...current, [row.id]: 'error' in checked ? checked.error : '' }));
    if ('row' in checked) {
      updateRow(photoId, row.id, { approved: true });
    }
  }

  function removePhoto(photo: Photo) {
    URL.revokeObjectURL(photo.previewUrl);
    setPhotos((current) => current.filter((candidate) => candidate.id !== photo.id));
  }

  if (!configured) {
    return (
      <p className="notice notice--danger" role="alert">
        El lector de catálogos no está configurado. Falta la dirección del servicio de analítica.
      </p>
    );
  }

  return (
    <div className="stack stack--wide">
      <section className="panel stack" aria-labelledby="paper-supplier-title">
        <h2 id="paper-supplier-title">1. Proveedor y fotos</h2>
        <p className="panel__detail">
          Toma una foto por hoja, derecha y con buena luz, o sube el PDF escaneado del proveedor (hasta 4 hojas por
          archivo). Claude propone las líneas; tú las revisas. Los archivos no se guardan y cada hoja cuesta unos
          centavos de dólar.
        </p>
        <div className="field field--narrow">
          <label htmlFor="paper-supplier">Proveedor</label>
          <input id="paper-supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
        </div>
        <label className="file-picker">
          <span className="button button--quiet">Elegir fotos o PDF</span>
          <input type="file" accept="image/jpeg,image/png,application/pdf" multiple onChange={choose} aria-label="Fotos del catálogo" />
        </label>
      </section>

      {photos.map((photo) => (
        <section key={photo.id} className="panel paper-page" aria-label={`Hoja ${photo.name}`}>
          <figure className="paper-page__photo">
            {photo.isPdf ? (
              <object data={photo.previewUrl} type={PDF_TYPE} aria-label={`PDF ${photo.name}`} className="paper-page__pdf">
                <p>PDF {photo.name}</p>
              </object>
            ) : (
              // A plain img: the source is a local object URL, which next/image cannot optimize.
              <img src={photo.previewUrl} alt={`Foto ${photo.name}`} />
            )}
            <figcaption>
              {photo.name}{' '}
              <button type="button" className="button button--quiet" onClick={() => removePhoto(photo)}>
                {photo.isPdf ? 'Quitar PDF' : 'Quitar foto'}
              </button>
            </figcaption>
          </figure>
          <div className="paper-page__rows stack">
            {photo.status === 'reading' && <p role="status">Leyendo la hoja…</p>}
            {photo.error && (
              <p className="notice notice--danger" role="alert">
                {photo.error}
              </p>
            )}
            {VAT_NOTES[photo.vatStatement] && <p className="notice paper-row--doubtful">{VAT_NOTES[photo.vatStatement]}</p>}
            {photo.status === 'ready' && photo.rows.length === 0 && <p>No se encontraron líneas en esta hoja.</p>}
            {photo.rows.map((row) => (
              <article
                key={row.id}
                data-testid="paper-row"
                className={`paper-row ${row.approved ? 'paper-row--approved' : row.issues.length > 0 ? 'paper-row--doubtful' : ''}`}
              >
                <div className="paper-row__fields">
                  <input aria-label="Código" value={row.supplierCode} disabled={row.approved} onChange={(e) => updateRow(photo.id, row.id, { supplierCode: e.target.value })} />
                  <input aria-label="Descripción" value={row.description} disabled={row.approved} onChange={(e) => updateRow(photo.id, row.id, { description: e.target.value })} />
                  <input aria-label="Unidad de compra" value={row.purchaseUnit} disabled={row.approved} onChange={(e) => updateRow(photo.id, row.id, { purchaseUnit: e.target.value })} />
                  <input aria-label="Piezas por unidad" inputMode="numeric" value={row.pieces} disabled={row.approved} onChange={(e) => updateRow(photo.id, row.id, { pieces: e.target.value })} />
                  <input aria-label="Costo sin IVA" inputMode="decimal" value={row.cost} disabled={row.approved} onChange={(e) => updateRow(photo.id, row.id, { cost: e.target.value })} />
                </div>
                {row.issues.length > 0 && !row.approved && (
                  <ul className="paper-row__issues">
                    {row.issues.map((issue) => (
                      <li key={issue}>{ISSUE_LABELS[issue] ?? issue}</li>
                    ))}
                  </ul>
                )}
                {rowErrors[row.id] && <p className="field__error">{rowErrors[row.id]}</p>}
                <div className="form__actions">
                  {row.approved ? (
                    <button type="button" className="button button--quiet" onClick={() => updateRow(photo.id, row.id, { approved: false })}>
                      Editar
                    </button>
                  ) : (
                    <button type="button" className="button" onClick={() => approve(photo.id, row)}>
                      Aprobar
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => updatePhoto(photo.id, (current) => ({ ...current, rows: current.rows.filter((c) => c.id !== row.id) }))}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {photos.length > 0 && (
        <section className="panel stack" aria-labelledby="paper-export-title">
          <h2 id="paper-export-title">2. Descargar la lista</h2>
          <p data-testid="approved-summary">
            {approved.length} {approved.length === 1 ? 'línea aprobada' : 'líneas aprobadas'}
            {pending ? '. Las que no apruebes no se descargan.' : '.'}
          </p>
          <div className="form__actions">
            <button
              type="button"
              className="button"
              disabled={approved.length === 0}
              onClick={() => download(priceListCsv(approved), priceListFileName(supplier))}
            >
              Descargar CSV para la caja
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
