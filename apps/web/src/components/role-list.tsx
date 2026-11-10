import { ROLE_LABELS, type AppRole } from '@/lib/identity';

interface RoleListProps {
  /** Role of the user according to the core, or `null` when the user has none. */
  role: AppRole | null;
  /** `false` when the core could not answer, so the role is unknown and not just missing. */
  known: boolean;
}

/** Shows the role of the user, a note when none is assigned, or a note when the core did not answer. */
export function RoleList({ role, known }: RoleListProps) {
  if (!known) {
    return <p className="panel__detail">Lo mostramos en cuanto el sistema central responda.</p>;
  }
  if (role === null) {
    return (
      <>
        <p className="panel__value">Sin rol asignado</p>
        <p className="panel__detail">Puedes entrar, pero no ver catálogo ni ajustes hasta que te asignen un rol.</p>
      </>
    );
  }
  return (
    <p className="panel__value" data-testid="role">
      {ROLE_LABELS[role]}
    </p>
  );
}
