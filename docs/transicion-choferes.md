# Transición de operadores de distribuidor a choferes

La migración de esquema agrega `driver_operator`, pero no cambia usuarios ni asigna órdenes automáticamente. La transición debe ejecutarse con una lista revisada por la empresa, porque un vínculo histórico con un distribuidor no determina qué chofer debe realizar cada entrega.

Para cada usuario confirmado como chofer:

```sql
update public.users
set role = 'driver_operator'
where id = '<user-id>'
  and role = 'distributor_operator';
```

Para cada orden en tránsito que corresponda al chofer:

```sql
update public.dispatch_orders
set driver_id = '<user-id>'
where id = '<order-id>'
  and status = 'confirmed';
```

Después de verificar las asignaciones, los vínculos en `distributor_users` pueden conservarse como historial o eliminarse de forma explícita. La aplicación nueva no los usa para autorizar entregas.

En datos locales de prueba se puede convertir todos los operadores antiguos de una vez:

```sql
update public.users
set role = 'driver_operator'
where role = 'distributor_operator';
```

No ejecutar la conversión masiva en producción sin validar antes la nómina de choferes.

Cuando no quede ningún usuario con `distributor_operator`, aplicar `supabase/migrations/20261016120000_drop_distributor_operator_role.sql`, que elimina el rol del enum. La migración aborta si todavía hay usuarios o solicitudes pendientes con ese rol.
