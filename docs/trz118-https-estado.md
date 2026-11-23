# TRZ-118: HTTPS público y pase a Vercel

## Estado comprobado — 22 de noviembre de 2026

URL final: **https://erpnext.132-226-26-114.sslip.io**.
Cata confirmó IP reservada `132.226.26.114`, ingress TCP 80/443 abiertos,
8080 sin ingress, SSH sin cambios y VNIC sin NSGs. La IP anterior fue retirada.
DNS y SSH comprobados, verificando la misma identidad anterior del servidor:
`SHA256:byl9i3bX82J8P+WOB0mzS4HfOJ1FavpJ5dqA6yXjBos` (ED25519).

SSH: `ambar@132.226.26.114`, sudo sin contraseña. No se modificó authorized_keys
de ubuntu. Compose: `/home/ubuntu/frappe_docker/pwd.yml`; sitio `frontend`, imagen
`frappe/erpnext:v16.52.1`. No se reiniciaron Docker ni la VM.

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

Archivo de entrega **solo en la VM**:
`/var/lib/trazflow-secrets/erpnext-vercel.json`, propietario root, modo 0600,
directorio 0700. Contiene `ERP_BASE_URL`, `ERP_API_KEY` y `ERP_API_SECRET`.
Cata puede acceder con sudo desde su sesión SSH y cargarlas directamente en
Vercel, sin imprimirlas en chats/logs ni copiarlas al repositorio. Después de
confirmar la carga, retirar el archivo temporal y conservarlas en el gestor de
secretos autorizado.

## Falta para cerrar

1. Cata: actualizar esas tres variables en los entornos correspondientes de Vercel,
   redeployar y verificar healthcheck y sincronización desde Integración ERP.
   El despliegue anterior usa credenciales ya revocadas hasta completar este paso.
2. Coordinar una ventana para reiniciar la VM. Verificar que conserva la IP,
   que Caddy/Docker arrancan, HTTPS sigue válido y la app sincroniza sin volver
   a editar variables. El reinicio todavía no se ejecutó.
3. Registrar esas evidencias antes de cerrar TRZ-118. El proxy y las credenciales
   están listos; no se afirma que Vercel ya esté actualizado.
