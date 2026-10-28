# ERPNext de la demo (Oracle Cloud)

> La app deployada en Vercel necesita un ERPNext accesible desde internet. Corre en una VM propia con el compose de
> ejemplo de [frappe_docker](https://github.com/frappe/frappe_docker). Contrato e integración: [`erp-contract.md`](erp-contract.md)
> y [`erp-sync.md`](erp-sync.md).
>
> **Nunca** van al repo: la clave SSH, la contraseña de Administrator, la del usuario del wizard ni las API keys.
> Van en `.env.local` (ignorado por git), en las variables de Vercel o en un gestor de contraseñas.

## Servidor

| | |
|---|---|
| Proveedor | Oracle Cloud Always Free, región US West (Phoenix) |
| VM | `erpnext-vm`, Ubuntu 24.04, `VM.Standard.A1.Flex` (**ARM / aarch64**), 2 OCPU, 12 GB RAM, ~47 GB de disco |
| IP pública | `129.146.120.18` (**efímera**: puede cambiar si la VM se detiene; entonces hay que actualizar `ERP_BASE_URL` en Vercel) |
| SSH | usuario `ubuntu`, clave privada propia (no está en el repo) |
| ERPNext | `http://129.146.120.18:8080`, sitio `frontend`, imagen `frappe/erpnext:v16.52.1` |

Desde WSL, la clave descargada en Windows hay que copiarla con permisos 600 (desde `/mnt/c` SSH la rechaza):

```bash
cp /mnt/c/Users/<usuario>/Downloads/ssh-key-AAAA-MM-DD.key ~/.ssh/oracle-erpnext.key
chmod 600 ~/.ssh/oracle-erpnext.key
ssh -i ~/.ssh/oracle-erpnext.key ubuntu@129.146.120.18
uname -m   # aarch64
```

## 1. Docker

Según la [guía oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/) (repo apt de Docker):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${UBUNTU_CODENAME:-$VERSION_CODENAME}) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu   # salir y volver a entrar por SSH para que tome el grupo
```

Quedó Docker 29.9.2 y Compose v5.6.1.

## 2. ERPNext

**ARM64:** el tag `frappe/erpnext:v16.52.1` que usa `pwd.yml` publica imágenes `amd64` y `arm64` en Docker Hub
(verificado el 27/10/2026), así que no hace falta compilar. Si en el futuro se cambia el tag, verificarlo antes:

```bash
curl -s https://hub.docker.com/v2/repositories/frappe/erpnext/tags/<tag> | python3 -c "import json,sys; print([i['architecture'] for i in json.load(sys.stdin)['images']])"
```

```bash
git clone https://github.com/frappe/frappe_docker
cd frappe_docker
docker compose -f pwd.yml up -d
docker compose -f pwd.yml logs -f create-site   # esperar a que termine (unos minutos)
```

- `pwd.yml` crea el sitio `frontend` y ya trae `FRAPPE_SITE_NAME_HEADER: frontend` en el servicio `frontend`, por eso
  entrar por IP no da "site not found".
- El README lo describe como *"Disposable demo only"*: alcanza para la demo de la materia, no para producción. La
  contraseña root de MariaDB es `admin`, pero el compose solo publica el puerto 8080.

### Recrear el sitio

Hace falta si el wizard quedó con otra abreviatura (ver paso 3). `drop-site` deja un backup en
`/home/frappe/frappe-bench/archived/sites` dentro del contenedor.

```bash
docker compose -f pwd.yml exec backend bench drop-site frontend --db-root-username root --db-root-password admin
docker compose -f pwd.yml exec backend bench new-site --mariadb-user-host-login-scope=% \
  --admin-password='<contraseña>' --db-root-username=root --db-root-password=admin \
  --install-app erpnext --set-default frontend
history -d $(history 1)   # que la contraseña no quede en el historial
```

Después se repiten los pasos 3 a 7 (las API keys cambian).

## 3. Setup Wizard

Entrar como `Administrator` y completar:

| Campo | Valor |
|---|---|
| Language / Country | Español / Argentina |
| Time Zone | `America/Argentina/Buenos_Aires` (**obligatorio**: `erpnext-client` asume `-03:00`, ver `ERPNEXT_UTC_OFFSET`) |
| Currency | ARS |
| Company | `TrazFlow Demo` |
| **Abbreviation** | **`SRV`** |
| Chart of Accounts | El que proponga (quedó `Argentina - Chart of Accounts`) |

**La abreviatura tiene que ser `SRV`.** ERPNext la agrega al id de cada depósito (`Depósito Central - SRV`), y en la
nube `DEP-01` y `DEPOSITO-NORTE` están vinculados a esos ids. Desde TRZ-101 los depósitos se vinculan solos por id y no
hay vínculo manual: con otra abreviatura, la sincronización crea depósitos nuevos y deja los actuales (con sus
pallets) inactivos. ERPNext v16 **no permite cambiar la abreviatura** después: hay que recrear el sitio.

El usuario que crea el wizard es una persona (System Manager). No se usa para la integración.

## 4. Contraseña de Administrator

Cambiarla apenas se crea el sitio (`pwd.yml` usa `admin`). Desde **My Settings → Change Password**, o:

```bash
docker compose -f pwd.yml exec backend bench --site frontend set-admin-password '<contraseña>'
history -d $(history 1)
```

## 5. Usuario de integración y API keys

1. **Users → Add User**: email `logistica@trazflow.test`, User Type **System User**, sin welcome email.
2. Roles: solo **Stock User** y **Sales User**. Alcanzan para leer Item, Batch, Warehouse, Sales Order y Delivery Note
   (verificado). Crear, etiquetar y comentar remitos todavía no se probó contra este servidor: si da 403, sumar el rol
   que falte, nunca System Manager.
3. Pestaña **More Information → API Access → Generate Keys** (el secret se muestra una sola vez; se puede descargar
   como CSV). Si el botón no aparece, desde la consola del navegador, logueado como System Manager:
   ```js
   frappe.call({ method: "frappe.core.doctype.user.user.generate_keys", args: { user: "logistica@trazflow.test" } }).then(r => console.log(r.message))
   ```
4. Cargarlas en `.env.local` y **borrar el CSV**.

El email coincide con el usuario de TrazFlow `logistica@trazflow.test`, pero son cuentas distintas: la de TrazFlow
está en Supabase y sirve para entrar a la app; la de ERPNext es la que usa el servidor de TrazFlow con
`ERP_API_KEY`/`ERP_API_SECRET`, sin importar quién esté logueado.

## 6. Campos personalizados

Los pide `ERPNEXT_CUSTOM_FIELDS` (`src/lib/erp/erpnext-client.ts`). Se crean como Administrator con `bench` (el
usuario de integración no tiene permiso sobre Custom Field). `--kwargs` se evalúa como Python: `True`, no `true`.

```bash
docker compose -f pwd.yml exec -T backend bench --site frontend execute \
  frappe.custom.doctype.custom_field.custom_field.create_custom_fields --kwargs "{
  'custom_fields': {
    'Delivery Note': [
      {'fieldname': 'trazflow_idempotency_key', 'label': 'TrazFlow Idempotency Key', 'fieldtype': 'Data', 'unique': 1, 'no_copy': 1, 'insert_after': 'customer'},
      {'fieldname': 'trazflow_operator', 'label': 'TrazFlow Operator', 'fieldtype': 'Data', 'no_copy': 1, 'insert_after': 'trazflow_idempotency_key'}],
    'Delivery Note Item': [
      {'fieldname': 'trazflow_pallet_code', 'label': 'TrazFlow Pallet Code', 'fieldtype': 'Data', 'no_copy': 1, 'insert_after': 'item_code'}]},
  'update': True}"
```

`no_copy` evita que duplicar un remito en ERPNext copie la clave única. Si se crean a mano (Customize Form), revisar
que el fieldname no quede con prefijo `custom_`.

## 7. Datos de prueba

`scripts/erpnext-seed-demo.py` replica `src/lib/erp/fixtures.ts` (los datos del mock, que son los que validan los
tests del contrato), así la demo con ERPNext se ve igual que con mock y encaja con lo que ya hay en la nube:

| Qué | Detalle |
|---|---|
| Depósitos | `Depósito Central - SRV`, `Depósito Norte - SRV`. Los que crea el wizard ("Sucursales - SRV", etc.) se borran si están vacíos: deshabilitados, TrazFlow igual los importa (como inactivos) y la sincronización nunca borra |
| Productos | `ACE-500`, `ARR-1KG`, `QSO-HORMA`, `SAL-FINA` (deshabilitado), todos con lote |
| Lotes y stock | Los 5 lotes del mock con las mismas cantidades, por un Material Receipt |
| Clientes | `CUST-NORTE` (Distribuidora Norte), `CUST-SUR` (Almacén del Sur): los mismos ids que en la nube |
| Órdenes | 4 Sales Orders confirmadas con las líneas de las órdenes pendientes del mock, numeradas por ERPNext (`SAL-ORD-2026-00001` a `00004`) |

Las órdenes **no** reusan `SAL-ORD-2026-00012..00015`: la nube ya las tiene y dos están entregadas. Además el script
activa los lotes en Stock Settings (v16 los trae apagados) y desactiva el inventario perpetuo de la empresa (el plan de
cuentas de Argentina no trae cuenta de inventario y la demo no usa contabilidad). Exige que la abreviatura sea `SRV`.

Es idempotente: se puede volver a correr y no duplica nada.

```bash
# desde la raíz del repo, en tu máquina
scp -i ~/.ssh/oracle-erpnext.key scripts/erpnext-seed-demo.py ubuntu@129.146.120.18:/tmp/
# en la VM
cd frappe_docker
docker cp /tmp/erpnext-seed-demo.py $(docker compose -f pwd.yml ps -q backend):/tmp/
docker compose -f pwd.yml exec -T -w /home/frappe/frappe-bench/sites backend ../env/bin/python /tmp/erpnext-seed-demo.py frontend
```

## 8. Firewall

- **Security List de la VCN** (consola de Oracle): ingress TCP 8080 desde `0.0.0.0/0`.
- **iptables de la VM**: la imagen de Ubuntu de Oracle rechaza todo en `INPUT` salvo el 22, pero no hizo falta abrir
  el 8080. Docker publica el puerto con sus propias reglas (NAT y cadena `FORWARD`), que no pasan por esa regla. Si
  algún día el puerto no responde desde afuera con el Security List abierto, revisar `sudo iptables -L -n` antes de
  agregar reglas.

## 9. Verificación

Desde tu máquina, con las variables en `.env.local`:

```bash
set -a; source .env.local; set +a
curl -s -H "Authorization: token $ERP_API_KEY:$ERP_API_SECRET" "$ERP_BASE_URL/api/method/frappe.auth.get_logged_user"
# {"message":"logistica@trazflow.test"}
```

Resultado al 28/10/2026, corriendo `ErpNextClient` (el adaptador real) contra el servidor, solo lectura:
`healthcheck` ok; `pullMasterData` con 2 depósitos, 4 productos, 5 lotes y 6 saldos; `pullDispatchOrders`
con 4 órdenes `pending`. No se probó todavía `reportDispatch` ni el envío de entregas.

## 10. Variables

| Variable | Valor | Dónde |
|---|---|---|
| `ERP_PROVIDER` | `erpnext` | Vercel. En local, `mock` si no querés pegarle al servidor |
| `ERP_BASE_URL` | `http://129.146.120.18:8080` | Vercel y `.env.local` |
| `ERP_API_KEY`, `ERP_API_SECRET` | las del paso 5 | Vercel y `.env.local`. **Solo servidor**: nunca con prefijo `NEXT_PUBLIC_` |

## Pendientes conocidos

- **HTTP sin TLS**: las keys viajan en texto plano entre Vercel y la VM. Para algo más que la demo, poner un dominio
  con HTTPS (por ejemplo un reverse proxy con Let's Encrypt).
- **IP efímera**: si cambia, actualizar `ERP_BASE_URL`. Se puede reservar una IP pública en Oracle.
- **Backups**: no hay backups automáticos. Manual: `docker compose -f pwd.yml exec backend bench --site frontend backup`.
