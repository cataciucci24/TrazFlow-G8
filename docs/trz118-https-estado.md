# TRZ-118: HTTPS público y persistencia verificada

## Estado comprobado — 22 de noviembre de 2026

URL final: **https://erpnext.132-226-26-114.sslip.io**.
Cata confirmó IP reservada `132.226.26.114`, ingress TCP 80/443 abiertos,
8080 sin ingress, SSH sin cambios y VNIC sin NSGs. La IP anterior fue retirada.
DNS y SSH comprobados, verificando la misma identidad anterior del servidor:
`SHA256:byl9i3bX82J8P+WOB0mzS4HfOJ1FavpJ5dqA6yXjBos` (ED25519).

SSH: `ambar@132.226.26.114`, sudo sin contraseña. No se modificó authorized_keys
de ubuntu. Compose: `/home/ubuntu/frappe_docker/pwd.yml`; sitio `frontend`, imagen
`frappe/erpnext:v16.52.1`. Prueba de reinicio completada el 23/11/2026.

Caddy 2.11.9 está activo y habilitado. `/etc/caddy/Caddyfile` usa el dominio final,
proxy a `127.0.0.1:8080` y HTTPS automático público, sin `tls internal`.
Copia sin secretos: [Caddyfile.production](../infra/erpnext/Caddyfile.production).
`host_name` de Frappe apunta a la URL final y se limpió la caché.

## Evidencias desde fuera de la VM

- HTTP `/login`: 308 hacia HTTPS en el dominio final.
- HTTPS `/login`: 200, verificación TLS correcta con la confianza del sistema.
- HTTPS `/api/method/ping`: `{"message":"pong"}`.
- Certificado público Let's Encrypt, emisor YE1, dominio final correcto.
  Vigencia UTC: 23/11/2026 00:30:49 a 21/02/2027 00:30:48
  (emitido el 22/11 en Argentina). Renovación automática a cargo de Caddy.
- Conexión TCP externa a 8080: no accesible en cuatro segundos.
- API autenticada: identidad de integración y lecturas de Item y Sales Order correctas.
- Credenciales anteriores: autenticación rechazada después de la rotación.

## Firewall y respaldos

Regla INPUT TCP 80/443 con comentario `trz118-https` persistida en
`/etc/iptables/rules.v4`; netfilter-persistent habilitado. Se conservaron SSH,
las demás reglas y Docker. El frontend sigue publicado por Docker en 8080;
el acceso exterior está cerrado en Oracle. No vaciar ni restaurar globalmente
iptables para aplicar esta configuración.

Respaldos exclusivos de root en la VM:

- `/var/backups/trazflow/trz118-pre-https/`: configuración previa del sitio,
  reglas y Caddyfile original. El respaldo del sitio contiene secretos.
- `/var/backups/trazflow/trz118-public-https/Caddyfile.before`: preparación
  anterior al certificado público, solo para diagnóstico histórico.

## Credenciales y pase a Cata

Se confirmó la cuenta `logistica@trazflow.test` y se renovaron tanto API key como
API secret mediante Frappe. Las nuevas credenciales se probaron por HTTPS y las
anteriores ya no autentican. No están en Git ni en el chat.

Se entregaron mediante `/var/lib/trazflow-secrets/erpnext-vercel.json`, solo en
la VM, propietario root, modo 0600, directorio 0700. Cata confirmó a través de
Ámbar que terminó la actualización de Vercel. Después de la prueba se retiró
el archivo temporal; las variables quedan bajo la administración de Cata.

## Reinicio y corrección — 23 de noviembre de 2026

Se coordinó el corte con Cata. El primer reinicio conservó IP y Caddy, pero los
servicios del ERP tenían `restart=on-failure`: los que salieron correctamente al
apagar la VM no arrancaron después. Eso dejó el proxy devolviendo 502.

Se corrigieron los nueve servicios permanentes a `restart=always` en Docker y
`deploy.restart_policy.condition: any` en `/home/ubuntu/frappe_docker/pwd.yml`.
Se conservó `condition: none` en configurator y create-site: son tareas de una
sola ejecución y no deben repetirse al arrancar. Compose validado con `config
--quiet`. Respaldo previo, solo root:
`/var/backups/trazflow/trz118-reboot/pwd.yml.before` (contiene secretos).

Se repitió un reinicio completo para comprobar el cambio:

- Boot ID inicial: `6c8c4a0e-38ae-48f5-ad8d-eb310ea64ef4`.
- Primer reinicio: `ac7dd097-29c1-4cb4-b9ba-ff780e775154`.
- Reinicio de verificación: `2fc33101-86e4-4d54-85cd-eed0f9740500`.
- Misma IP reservada y misma identidad SSH.
- Caddy y Docker activos; nueve contenedores arrancaron automáticamente, DB healthy.
- Regla iptables 80/443 conservada tras reiniciar.
- HTTPS login 200 con TLS válido, ping pong, HTTP 308 y 8080 cerrado externamente.
- Adaptador real `ErpNextClient`, ejecutado desde la computadora de prueba por
  HTTPS: healthcheck correcto; `pullMasterData` con 2 depósitos, 8 productos,
  11 lotes y 11 saldos; `pullDispatchOrders` con 8 órdenes. Solo lectura,
  sin crear despachos ni escribir en la base de datos de la app.

Vercel fue confirmado por Cata; no se inspeccionaron sus variables ni se ejecutó
un sync desde la interfaz desplegada en esta prueba. La evidencia independiente
registrada aquí cubre la VM, HTTPS y el adaptador real después del reinicio.
