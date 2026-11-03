-- TRZ-104: la sincronización automática con el ERP pasa de cada 15 minutos a una vez por día, a las 06:02 de
-- Argentina (09:02 UTC; pg_cron usa UTC), para que el equipo arranque el día con remitos, saldos y órdenes al día.
-- Durante el día, logística sincroniza a mano con "Sincronizar" cuando lo necesite.
-- El envío de reportes pendientes (trazflow-erp-outbox) sigue cada 5 minutos.
-- cron.schedule con el mismo nombre reemplaza el job existente.
select cron.schedule('trazflow-erp-sync', '2 9 * * *',
  $job$select public.trazflow_cron_request('/api/cron/erp-sync');$job$);
