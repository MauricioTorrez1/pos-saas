import { ROLE_LABELS, type AppRole } from '@/lib/identity';

interface RoleListProps {
  roles: readonly AppRole[];
}

/** Shows the roles of the user, or a note when the realm has not assigned one yet. */
export function RoleList({ roles }: RoleListProps) {
  if (roles.length === 0) {
    return (
      <>
        <p className="panel__value">Sin rol asignado</p>
        <p className="panel__detail">Puedes entrar, pero no ver catálogo ni ajustes hasta que te asignen un rol.</p>
      </>
    );
  }
  return (
    <ul className="roles" aria-label="Roles">
      {roles.map((role) => (
        <li key={role} className="pill">
          {ROLE_LABELS[role]}
        </li>
      ))}
    </ul>
  );
}
