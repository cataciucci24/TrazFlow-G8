# TRZ-118: preparación realizada y pase a Cata

## Estado comprobado

Acceso SSH confirmado como `ambar@129.146.120.18`, con sudo sin contraseña y
Docker. La clave privada permanece fuera del repositorio. No se modificó
`authorized_keys` de ubuntu. Compose existente: `/home/ubuntu/frappe_docker/pwd.yml`;
sitio `frontend`, imagen `frappe/erpnext:v16.52.1`, backend publicado en 8080.

Se instaló Caddy 2.11.9 ARM64 desde el repositorio estable oficial y quedó activo
y habilitado en systemd. Configuración activa: `/etc/caddy/Caddyfile`; copia de
referencia: [Caddyfile.preparation](../infra/erpnext/Caddyfile.preparation).

Dominio provisional verificado por DNS: `erpnext.129-146-120-18.sslip.io`.
`host_name` de Frappe se configuró como `https://erpnext.129-146-120-18.sslip.io`
y se limpió la caché del sitio.

El certificado actual es **interno de preparación**, no confiable públicamente.
Se evitó solicitar certificados ACME antes de abrir Oracle y fijar la IP.
`skip_install_trust` evita instalar la CA local en la confianza del sistema.
No cambiar Vercel a esta URL todavía.

## Firewall y respaldo

Se agregó únicamente una regla INPUT para conexiones TCP nuevas a 80/443,
comentario `trz118-https`, antes del REJECT existente. Se conservaron SSH y
las demás reglas. La misma regla quedó en `/etc/iptables/rules.v4`, validada
con `iptables-restore --test`. `netfilter-persistent` sigue habilitado.
No se restauró ni vació globalmente iptables y no se cambiaron reglas Docker.

Respaldo previo, solo en la VM y accesible por root:
`/var/backups/trazflow/trz118-pre-https/`. Contiene la configuración previa del
sitio, reglas persistidas y reglas en ejecución; además, el Caddyfile original
del paquete. No copiar el respaldo del sitio al repo: contiene secretos.

## Evidencia de preparación

- Nueva conexión SSH correcta después del cambio.
- Caddy activo y habilitado; listeners 80/443.
- Validación de Caddyfile correcta.
- HTTP local: 308 hacia HTTPS.
- HTTPS local validado con la CA interna explícita: login 200 y ping `pong`.
- Backend directo en localhost:8080 sigue devolviendo `pong`.
- Desde la computadora de prueba: 80/443 sin conexión en cuatro segundos;
  8080 accesible. Falta aplicar el Security List de Oracle.

No se probó reinicio de la VM: queda para después de reservar la IP y coordinar
la ventana con Cata. No se rotaron API keys ni se cambió Vercel.

## Siguiente pase: Cata

1. Reservar/asignar la IP pública y pasar su nuevo valor.
2. Abrir TCP 80/443 y cerrar 8080 en el Security List de Oracle, conservando SSH.
3. Confirmar esos cambios antes de continuar con el certificado público.

La IP puede cambiar: el dominio sslip.io incluye la IP y también deberá cambiar.
No mantener el dominio provisional cuando ya no resuelva a la VM.

## Después: persona 1

1. Reconectar a la IP reservada usando el mismo usuario y verificando la identidad
   del servidor. Fingerprint ED25519 observado:
   `SHA256:byl9i3bX82J8P+WOB0mzS4HfOJ1FavpJ5dqA6yXjBos`.
2. Verificar DNS para el dominio de la IP nueva y acceso público a 80/443.
3. Editar `/etc/caddy/Caddyfile.public-next` con el dominio nuevo, sin `tls internal`.
   Validar, instalar como configuración activa y recargar Caddy. Ese borrador ya
   está preparado en la VM, pero todavía no está activo.
4. Actualizar `host_name` de Frappe, limpiar caché y comprobar certificado
   público sin ignorar errores TLS; comprobar que 8080 no responde externamente.
5. Confirmar el usuario de integración actual y rotar sus claves. La documentación
   histórica identifica `logistica@trazflow.test`; verificar antes de modificarlo.
   Entregar las credenciales nuevas a Cata por el canal privado acordado, nunca Git.

Cata actualizará `ERP_BASE_URL`, `ERP_API_KEY` y `ERP_API_SECRET` en Vercel,
redeployará y verificará healthcheck/sync. Finalmente coordinar reinicio y comprobar
que la IP y la integración se conservan. TRZ-118 sigue abierta hasta esas pruebas.
