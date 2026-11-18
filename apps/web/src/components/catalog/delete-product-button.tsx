'use client';

import { useState, useTransition } from 'react';

interface DeleteProductButtonProps {
  action: () => Promise<{ error: string | null }>;
  productName: string;
}

/** Deletes a product after asking. The deletion is logical: sales that already used it keep their history. */
export function DeleteProductButton({ action, productName }: DeleteProductButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`¿Dar de baja «${productName}»? Las cajas dejarán de venderlo.`)) {
      return;
    }
    startTransition(async () => {
      const result = await action();
      setError(result.error);
    });
  }

  return (
    <div className="stack">
      <button type="button" className="button button--danger" onClick={remove} disabled={pending}>
        {pending ? 'Dando de baja…' : 'Dar de baja'}
      </button>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
