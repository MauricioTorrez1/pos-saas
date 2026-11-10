# ADR 0038: Bitácora de auditoría de solo agregar

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-12. Se apoya en los ADR 0004 y 0035.

## Contexto
RF-040 y RNF-07 piden registrar cada cambio sensible con usuario, hora, valor anterior y valor nuevo, sin que nadie pueda editarlo. Una auditoría que se puede borrar no sirve ante un fraude.

## Opciones
**Cómo impedir la edición**
1. **Privilegios más un disparador (trigger).** El rol de la aplicación no recibe `UPDATE`, `DELETE` ni `TRUNCATE`, y un disparador los rechaza también para el dueño de la tabla.
2. **Solo privilegios.** El dueño o un administrador podría editar sin que nada lo impida.
3. **Encadenar hashes.** Detecta manipulación, pero añade complejidad que hoy no se justifica.

**Cómo se escribe**
1. **Servicio `AuditLog` con transacción obligatoria**: el registro se guarda junto con el cambio.
2. **Disparadores en cada tabla.** No conocen al usuario de la aplicación y registran cambios que no son sensibles.

## Decisión
- V4 crea `audit_log` (`actor_id`, `action`, `entity_type`, `entity_id`, `old_value` y `new_value` en `jsonb`, `created_at`) con RLS forzada y la política de `tenant_id` (ADR 0035). `tenant_id` toma `current_tenant_id()` por defecto, así que un llamador no puede escribir en otro negocio. No lleva llave foránea a `tenant`: la bitácora sobrevive a lo que describe.
- `pos_app` solo puede leer y agregar. Un disparador por fila (`UPDATE`/`DELETE`) y otro por sentencia (`TRUNCATE`) lanzan una excepción para cualquier rol.
- `AuditLog.record` usa `Propagation.MANDATORY`: sin transacción falla, porque un registro que pudiera guardarse aparte también podría perderse sin el cambio.
- Qué se audita: cambios de precio, ajustes de inventario, descuentos, cancelaciones, aperturas y cortes de caja, roles y permisos, y cambios de configuración. Cada tarea que cree uno de estos cambios llama a `record`.
- Qué no se guarda: PIN, tokens, datos de tarjeta ni datos personales que la auditoría no necesite (OWASP Logging). Solo ids y valores de negocio.

## Consecuencias
- Auditoría y logs son distintos: los logs sirven para depurar y rotan; la bitácora es un registro de negocio permanente.
- Seis pruebas con Testcontainers: guarda usuario, hora y valores; se pierde junto con un cambio revertido; exige transacción; aísla negocios; el rol de la aplicación y el dueño no pueden editar ni borrar.
- Un administrador con acceso de superusuario puede alterar el disparador. Contra eso solo ayudan los respaldos y el control de acceso a la base.
