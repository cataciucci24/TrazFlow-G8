# Modelo de roles de TrazFlow

Estado al 13/10/2026. TrazFlow registra la ejecución física de la operación; el ERP es la fuente de productos, lotes, stock y ventas.

## Roles visibles

| Rol | Responsabilidad | Acceso operativo |
|---|---|---|
| `logistics_manager` | Responsable logístico | Gestiona órdenes, pallets, trazabilidad, operadores y asignación de choferes. |
| `warehouse_operator` | Operador de depósito | Valida pallets y confirma el despacho físico. |
| `driver_operator` | Chofer | Ve únicamente órdenes en tránsito asignadas a su usuario y confirma su entrega. |

El destinatario se conserva en `distributors` como dato comercial de la orden. No es un rol, no necesita usuario y no inicia sesión en TrazFlow.

## Autorización

- Cada perfil pertenece a una empresa y las policies RLS verifican empresa, rol y acceso revocado.
- Las órdenes de un chofer se autorizan por `dispatch_orders.driver_id = auth.uid()`. La UI no decide el permiso.
- El chofer procesa una entrega únicamente mediante `confirm_delivery_pallet`, que vuelve a validar asignación, estado, QR e idempotencia dentro de la base.
- Logística asigna o reasigna chofer mediante `assign_order_driver`; el `UPDATE` directo de órdenes permanece revocado.
- Un chofer revocado deja de superar `auth_role()` y pierde acceso aunque conserve historial como autor de eventos.

## Registro y operadores

Una persona puede solicitar `warehouse_operator` o `driver_operator`. El responsable logístico aprueba o rechaza la solicitud y puede revocar o restaurar el acceso. La pantalla Operadores muestra cuántas entregas en tránsito tiene cada chofer.

`distributor_operator` permanece en el enum solo para datos históricos. No aparece en el registro ni en la navegación. La conversión de usuarios existentes y la asignación de órdenes se realizan de forma explícita siguiendo `docs/transicion-choferes.md`.

## Flujo de entrega

1. Logística conserva el destinatario de la orden y asigna un chofer activo de la misma empresa.
2. Depósito confirma el despacho y la orden queda `confirmed` (En tránsito).
3. El chofer abre Mis entregas, escanea los pallets y registra entregado, faltante, sobrante, dañado o no corresponde.
4. La orden pasa a `delivered` cuando todos los pallets esperados fueron procesados sin diferencias, o a `delivered_with_discrepancy` si existe alguna diferencia.
5. Cada resultado genera trazabilidad. El cierre con diferencia genera además una notificación para logística.
