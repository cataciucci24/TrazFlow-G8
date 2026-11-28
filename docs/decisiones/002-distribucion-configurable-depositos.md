# Distribución configurable de depósitos

Estado: **Propuesto** para revisión del equipo (TRZ-115).

## Contexto

Los depósitos pueden organizar sus ubicaciones de distintas maneras. Una
distribución con estanterías puede usar pasillo, estantería, nivel y posición;
un depósito de piso puede usar sector, hilera y posición. Cada depósito necesita
elegir entre uno y cuatro niveles y asignarles nombres comprensibles para su
operación.

El modelo existente ya guarda ubicaciones físicas, identificadores, códigos,
etiquetas QR y referencias de pallets e historial. La distribución configurable
debe incorporarse conservando esos datos y los flujos de ubicación existentes.

## Decisión propuesta

Usar una plantilla ordenada por depósito en `warehouses.layout`, almacenada como
JSONB. Contiene entre uno y cuatro objetos, cada uno con un `label` de texto no
vacío. La plantilla inicial es Pasillo → Estantería → Nivel → Posición. También
se ofrece el preset de piso Sector → Hilera → Posición y se pueden personalizar
las etiquetas.

Los valores de cada ubicación siguen en las columnas existentes, en este
orden: `aisle`, `rack`, `level` y `position`. `aisle` es obligatorio; las
columnas correspondientes a niveles no utilizados son NULL. La base valida que
las coordenadas completas coincidan con la cantidad de niveles configurada y
que no se dupliquen dentro de una empresa y un depósito, tratando los NULL como
iguales en la restricción de unicidad.

Reutilizar estas columnas permite mantener las consultas y relaciones existentes
sin trasladar cada ubicación a una estructura nueva. Los UUID y códigos de
ubicación se conservan, al igual que el formato de QR `TRZLOC:<uuid>`, las
referencias de pallets y los eventos históricos. Cambiar una etiqueta modifica
la forma de presentar el nivel, no la identidad de la ubicación.

## Alternativa: árbol genérico con `parent_id`

Un árbol podría representar cada sector, pasillo o posición como un nodo con
referencia a su padre. Ofrecería jerarquías de profundidad variable y ramas con
formas diferentes dentro del mismo depósito.

Se descarta para el alcance actual porque la historia requiere una plantilla
común de hasta cuatro niveles por depósito. Introducir nodos y recorridos de
árbol exigiría adaptar consultas, validaciones, generación, relaciones y
pantallas existentes, además de definir una migración de ubicaciones e
historial. Esa complejidad y el riesgo de compatibilidad no se justifican para
los casos actuales. Si se necesitan ramas heterogéneas o más niveles, esta
alternativa deberá reevaluarse.

## Restricciones y consecuencias técnicas

Si un depósito ya tiene ubicaciones, se pueden renombrar etiquetas, pero no
cambiar la cantidad de niveles. La base protege esta regla; la creación de
ubicaciones y los cambios de distribución se coordinan mediante el bloqueo de
la fila del depósito. La creación individual también comprueba el estado activo
después de adquirir ese bloqueo.

El responsable logístico de la misma empresa puede modificar el layout,
incluido el layout físico de un depósito proveniente del ERP. Esto no habilita
la edición de otros datos administrados por el ERP. Las reglas de empresa y rol
se mantienen en la aplicación y en la base.

Las ventajas son un modelo simple para las distribuciones previstas, etiquetas
configurables por depósito y compatibilidad con los identificadores y flujos
existentes. También facilita generar ubicaciones a partir de rangos.

Las desventajas son el máximo fijo de cuatro niveles, la correspondencia
posicional entre etiquetas y columnas y la necesidad de validar el JSONB y las
coordenadas conjuntamente. Las columnas conservan nombres técnicos históricos
que no siempre coinciden con las etiquetas visibles. El orden de niveles no
representa por sí mismo distancias ni relaciones espaciales complejas.

## Límites y fuera de alcance

Una plantilla se aplica a todo el depósito: no admite distintas jerarquías por
rama ni más de cuatro niveles. Tampoco modela mapas, capacidad, geometría ni
transferencias entre depósitos. La sugerencia automática de ubicación de pallets
corresponde a TRZ-67 y queda fuera de esta decisión.

La documentación de este diseño como propuesta no implica aprobación formal
del equipo. Su implementación y pruebas locales se describen en
[`trz96-ubicaciones.md`](../trz96-ubicaciones.md).
