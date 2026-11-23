# Persona 1: pendientes y cómo retomarlos

Rama final: `codex/persona-1-verificacion-final`.
El resumen de pruebas está en [persona-1-calidad.md](persona-1-calidad.md).

## TRZ-118: HTTPS, IP fija y rotación

**Por qué falta:** no hay acceso a la consola Oracle ni clave SSH de `erpnext-vm`.
La conexión disponible de Vercel tampoco tiene acceso al equipo configurado.
La infraestructura remota no se puede validar ni cambiar desde el acceso actual.

**Qué pedir al equipo:** responsable de Oracle, acceso a la instancia y a su
VCN/VNIC, acceso SSH mediante archivo privado entregado fuera de Git y del chat,
dominio elegido y responsable del proyecto Vercel. Confirmar el sitio y el compose
reales de ERPNext antes de ejecutar cambios. No se necesita entregar contraseñas
personales ni copiar secretos a esta documentación.

**Material listo:** [plantilla Caddy](../infra/erpnext/Caddyfile.example) y el
[estado histórico del servidor](erpnext-deploy.md). `erp.example.com` es un
marcador que debe reemplazarse. La sintaxis se validó con Caddy en un contenedor
sin red; eso no demuestra DNS, certificados ni acceso al ERP real. No se ha
aplicado a ninguna VM.

### Secuencia para el administrador

1. Identificar la VM, su VNIC/IP privada y la IP pública actual. Guardar los
   valores y una copia de las configuraciones actuales. Coordinar la ventana
   porque sustituir la IP pública corta las conexiones que usan la anterior.
2. Crear y asignar una IP pública **reservada** en Oracle. Para asignarla a esa
   IP privada, primero debe quedar sin otra IP pública asignada. Comprobar el
   acceso SSH por la nueva dirección antes de seguir. Ver
   [asignación de IP reservada de Oracle](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/reserved-public-ip-assign.htm).
3. Configurar el DNS del dominio elegido hacia la IP reservada. Revisar también
   cualquier registro AAAA para que no dirija a otro servidor.
4. Conservar SSH y habilitar TCP 80/443 hacia Caddy en las reglas de Oracle y en
   el firewall real del sistema. No reemplazar a ciegas las reglas de iptables:
   inspeccionar primero las reglas existentes y su mecanismo de persistencia.
5. Instalar Caddy desde su [distribución oficial](https://caddyserver.com/docs/install).
   Confirmar que `curl -I http://127.0.0.1:8080` responde dentro de la VM.
   Copiar la plantilla, reemplazar el dominio y validar antes de recargar:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl reload caddy
   sudo systemctl status caddy --no-pager
   ```

   Si Caddy aún no está iniciado, iniciar/habilitar su servicio según la instalación.
   Caddy gestiona certificados y redirección a HTTPS cuando el dominio, DNS,
   puertos y almacenamiento de certificados están correctamente configurados.
   Ver [HTTPS automático](https://caddyserver.com/docs/automatic-https) y
   [reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy).
6. Probar `https://<dominio>` desde fuera de la VM, sin ignorar errores del
   certificado. Revisar enlaces y redirecciones del sitio de ERPNext; si hace
   falta, ajustar su `host_name` a esa URL tras confirmar el sitio real.
7. Cerrar 8080 al exterior en Oracle y, preferentemente, publicar el frontend
   Docker solo en `127.0.0.1:8080`. Aplicar ese cambio en el compose real ya
   inspeccionado, no en un servicio supuesto. Confirmar que Caddy sigue llegando
   al backend y que `http://<IP>:8080` falla desde otra red.
8. Rotar las credenciales del usuario de integración en ERPNext. Actualizar
   `ERP_BASE_URL=https://<dominio>`, `ERP_API_KEY` y `ERP_API_SECRET` en los
   entornos de Vercel que correspondan. Las claves son variables de servidor:
   nunca `NEXT_PUBLIC_*`. Crear un nuevo despliegue y comprobar conexión y
   sincronización desde **Integración ERP**. Revocar las credenciales anteriores
   y verificar que ya no autentican. No volver a usarlas como rollback.
9. Coordinar un reinicio de la VM. Confirmar que conserva la IP, que Caddy
   arranca y que la app vuelve a sincronizar sin editar Vercel. Actualizar
   `erpnext-deploy.md` con valores reales y evidencias sin secretos.

Si falla antes del corte de Vercel, reparar la configuración del proxy usando
su copia anterior y repetir la validación; no desactivar TLS ni abrir 8080 como
solución permanente. Si falla después de rotar, corregir con las credenciales
nuevas. No declarar TRZ-118 terminada hasta verificar todos sus criterios.

**Evidencias que faltan:** URL con certificado válido, 8080 cerrado desde otra
red, healthcheck y sync de la app desplegada, credenciales anteriores revocadas
y reinicio conservando la IP. Odoo necesitará su dominio/proxy cuando se despliegue;
el adaptador actual es de lectura y no hay despliegue Odoo confirmado.

## TRZ-119: protección de ramas

El workflow existe y puede ejecutarse en ramas de persona 1, PR y ramas base.
La dueña del repo debe exigir el check `CI` en `develop` y `main`. El archivo YAML
no activa por sí solo esa protección. La consulta de protección de ambas ramas
respondió 403 (la integración no tiene permisos administrativos): no se pudo
confirmar ni modificar su estado actual. Con permisos de administración:

1. Abrir las reglas de ambas ramas en GitHub.
2. Exigir PR y el check `CI`; comprobar el nombre del check de una ejecución real.
3. Verificar con un PR de prueba que un test roto impide el merge y que, al
   corregirlo, queda verde. No introducir deliberadamente un test roto en esta rama.

## TRZ-73 / TRZ-124: cierre de documentación

**Por qué falta el cierre definitivo:** el sprint sigue recibiendo cambios de
otras personas. La guía actual describe el código disponible, no funciones futuras.

- Tras TRZ-112, actualizar alta de empresa y configuración de ERP por empresa.
- Tras TRZ-74 y TRZ-31, actualizar reenvío de solicitudes y recuperación de acceso.
- Tras depósitos/layouts y pallets mixtos, revisar las guías de ubicaciones,
  sincronización y contrato sin prometer esos flujos antes de su merge.
- Agregar la URL pública verificada, los siete integrantes y sus aportes, y los
  C4 definitivos de TRZ-125. Confirmar si existen cuentas demo de producción;
  los usuarios públicos del seed son exclusivamente locales.
- Hacer la revisión cruzada con otra persona y actualizar la captura si cambia
  la interfaz. Odoo ya debe describirse como disponible para lectura, no pendiente.

## Para retomar el trabajo

El worktree de verificación queda en `C:\Users\ambar\TrazFlow-G8-persona-1`.
No contiene secretos. Antes de continuar, hacer fetch, comparar con
`origin/develop` e integrar los merges nuevos en la rama de persona 1. Repetir
`npm run lint`, `npm run typecheck`, `npm run test:coverage` y el build con
variables ficticias, además de los proyectos de navegador afectados.

No cerrar tickets de infraestructura ni documentación final por el solo hecho
de que la rama de código pase los tests. Registrar las evidencias externas cuando
se obtengan los accesos y se completen las dependencias.
