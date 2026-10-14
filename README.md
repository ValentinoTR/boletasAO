# AO Nexus Central

Compras, inventario, ventas, boletas, clientes y productos de la tienda pública comparten una base de datos. El panel conserva el formato PDF y la configuración de correo de Boletas AO.

## Uso

1. Ingresar con la cuenta de Boletas AO.
2. En **Conexión inicial**, importar las compras del contabilizador anterior con su correo y contraseña. La sesión de importación es temporal y la contraseña no se almacena. La importación repetida solo incorpora registros nuevos.
3. En **Mi web → Compartir stock**, relacionar cada producto publicado con sus unidades reales de inventario. Revisar la cantidad antes de confirmar. El precio publicado se guarda por separado.
4. Al crear una boleta, **Seleccionar productos para esta venta** abre **Mi stock**: solo lo que tienes, un renglón por producto con su cantidad y el precio de tu web, sin costos (los costos se ven en **Compras**). La búsqueda acepta las palabras en cualquier orden, la marca y el modelo (por ejemplo «AMD 7800X3D»). **Agregar** suma el producto a la venta sin formulario y avisa cuánto quedará; al emitir la boleta el stock baja y, si se elimina, vuelve. Para que la venta descuente el stock, **Agregar** registra lo que haga falta: las unidades de Compras con el mismo nombre se vinculan al producto (conservan su costo) y la cantidad del catálogo anterior que falte se registra como unidades sin costo. Lo que no está en stock aparece solo al buscarlo (**Venderlo igual**) o desde **¿No está en tu stock?**, con nombre y precio; se registra en Compras con el proveedor «Venta sin stock» y no cambia ningún stock, ni siquiera si luego se elimina la boleta. Si se escribe a mano algo que se parece a un producto que tienes, la pantalla avisa antes de venderlo como de otra tienda. Varios productos distintos en una misma línea se imprimen juntos («Computadora completa»); para líneas separadas se usa «Agregar producto» en la boleta.
5. Escribir el precio final de la boleta. Si cambia respecto de los precios de sus componentes, se distribuye entre ellos conservando cada céntimo. Los costos quedan guardados para calcular la ganancia.
6. Al emitir, la boleta, el comprador y la venta se guardan juntos. Las unidades dejan de estar disponibles. Descargar o reenviar una boleta emitida conserva el mismo registro. Al emitir (con o sin envío por correo) se abre sola una boleta nueva con el número siguiente, por ejemplo de B001-110 a B001-111; si el correo falla, la pantalla conserva la boleta emitida hasta reintentar el envío. Las boletas anteriores se consultan en **Boletas emitidas**.
7. Para corregir una boleta equivocada, abrir **Boletas emitidas → Eliminar** y pulsar **Sí, eliminar boleta** en la ventana de la página. Esa ventana muestra el progreso o cualquier error y permite reintentar. Desaparece del historial y de las ventas; sus unidades vuelven al inventario y se recalcula la ganancia. Las compras externas se conservan como compras reales, con sus unidades disponibles para otra venta. Después se puede emitir la boleta correcta. El número eliminado queda reservado; los correos ya enviados y los PDF descargados no se retiran.
8. **Mi web** e **Inventario** abren en **En stock**. Los productos agotados se conservan en **Para reponer**. **Modificar stock** corrige la cantidad disponible; una reducción retira unidades sin borrar la compra ni cambiar costos o ganancias anteriores. **Reponer** registra una nueva compra con cantidad, proveedor y fecha; el costo por unidad es opcional (vacío se guarda como S/ 0.00 y puede completarse después en Compras mientras la unidad no se haya vendido; el costo total de una compra queda fijo apenas se emite una boleta con una de sus unidades —las ventas registradas solo en Compras o Inventario no lo bloquean—, pero el costo de cada unidad sin vender sí se puede ajustar). Para que la ganancia sea exacta, completa el costo antes de emitir la boleta.
9. **Agregar producto** pregunta cuántas unidades ingresan y, opcionalmente, su costo. Con cantidad 0, guarda la ficha y la foto para una reposición futura. Al registrar una compra también se pide cantidad y se puede asociar al producto de la web. El costo de esa compra es el total, con su cambio, impuestos y envío; para combos de piezas distintas se indica 0 y se agregan los componentes con sus cantidades.
10. **Clientes → Eliminar** quita de la lista a un cliente que no tiene boletas emitidas (por ejemplo, uno de prueba o duplicado); no afecta boletas, ventas ni stock, y si vuelve a comprar se registra de nuevo. Un cliente con boletas se conserva porque sus boletas son el historial de la venta: si alguna fue un error, se elimina primero en **Boletas emitidas**. Requiere ejecutar una vez `database/delete_clients.sql` en el editor SQL de Supabase (repetirlo no hace daño).
11. El botón **Modo claro / Modo oscuro** aplica la elección al panel, formularios, boletas, tablas y ventanas. Se recuerda al volver a entrar. La tienda pública tiene su propio botón y recibe el tema elegido al abrirla desde el panel. El PDF conserva su formato original para impresión.

En **Inventario**, las cantidades del catálogo anterior también se muestran aunque todavía no tengan unidades vinculadas a Compras. Se agrupan con las unidades del mismo producto sin contarlas dos veces; las unidades sin costo registrado se indican como «costo pendiente».

En **Compras**, la ganancia del combo y de sus componentes aparece como «Pendiente» hasta vender todos los componentes. Al completar la venta, el resultado del combo es el total recuperado menos el costo completo de la compra, incluidos envío e impuestos. Si se anula una venta, vuelve a quedar pendiente. Los indicadores de Resumen y Ventas conservan el cálculo por unidades vendidas.

Descuento automático del stock web: el stock de un producto vinculado a unidades reales baja solo cuando una de ellas se vende, ya sea en una boleta o en **Compras**, y vuelve si se elimina la boleta. Los productos del catálogo anterior solo tienen una cantidad, por eso **Mi web → Activar descuento automático** registra esas cantidades como unidades sin costo (S/ 0.00, completables después en Compras) y desde entonces sus ventas descuentan stock. También se activa producto por producto al agregarlo a una boleta desde el buscador. Si en Compras ya hay unidades con el mismo nombre y la misma cantidad, el botón las vincula conservando su costo real en lugar de crear otras; si la cantidad no coincide, lo indica para revisarlo con **Compartir stock**. Las compras creadas llevan el proveedor «Stock inicial (catálogo anterior)». Si ya registraste esas compras con su costo real, usa **Compartir stock** en cada producto en lugar del botón. Las unidades nuevas de un producto deben registrarse con **Reponer** o **Modificar stock**, o eligiendo el producto en «Producto de mi web» al registrar la compra; las unidades agregadas con «Agregar componente» o dejadas en «Sin vincular al catálogo» no cuentan para el stock web.

El catálogo existente mantiene sus cantidades anteriores hasta que se vinculan unidades. Las compras privadas del proyecto anterior requieren la cuenta de ese contabilizador para importarse.

## Código

- `dist/` se edita a mano. Después de cada cambio ejecutar `python publish.py`: actualiza los `?v=` de caché de los HTML y copia `dist/` a la raíz, que es lo que sirve GitHub Pages. `tests/check_assets.py` falla si la raíz o los `?v=` quedaron desactualizados.
- `build_suite.py` y `build_stock.py`: generadores originales del panel (a partir de `original/`). Ya no reproducen la versión actual y requieren `.openai/hosting.json`; no los ejecutes sobre `dist/` porque sobrescribirían estos cambios.
- `dist/assets/suite.js`: catálogo, clientes, selección de componentes e importación.
- `dist/assets/suite-core.js`: cálculos y reparto de precios en céntimos.
- `database/suite.sql`: esquema inicial y funciones del inventario compartido; ya aplicado al proyecto de Boletas AO. No ejecutarlo otra vez como un cambio incremental.
- `database/delete_receipts.sql`: actualización de eliminación del historial y reversión atómica de ventas; ya aplicada al proyecto actual. Conserva internamente el número y el registro original para impedir reintentos y duplicados. Solo el equipo con acceso activo puede eliminar.
- `database/delete_clients.sql`: actualización **pendiente de aplicar**: ejecutarla una vez en el editor SQL de Supabase para habilitar **Clientes → Eliminar** (solo clientes sin boletas emitidas). `tests/clients.sql` la comprueba contra PostgreSQL y termina con `ROLLBACK`.
- `database/receipt_allocator.sql`: numerador de boletas con bloqueo de reintentos de registros eliminados.
- `database/stock_management.sql`: actualización ya aplicada para cantidades, compras atómicas, correcciones y reposición con permisos de equipo y protección contra reintentos duplicados. Las unidades retiradas se conservan para no redistribuir el costo de compra.
- `dist/assets/theme.js`, `theme.css` y `receipt-theme.css`: tema compartido por las secciones y marcos del panel.
- `supabase/functions/ao-api/`: función de correo actualizada; bloquea el envío de boletas eliminadas.
- `build_integrations.py`: prepara el catálogo público y las entradas hacia el panel central.
- `integrations/contabilizador/legacy.html`: copia del contabilizador anterior para consulta durante la transición.

Las fotos nuevas se guardan en `ao-product-images`. El catálogo público recibe solo productos, precios, fotos y disponibilidad mediante `ao_catalog_snapshot`. Los costos, clientes y boletas requieren pertenecer al equipo autenticado.

## Validación

```sh
python publish.py
python build_integrations.py
python tests/check_assets.py
node --test tests/*.test.cjs
```

`tests/transactions.sql` prueba contra PostgreSQL precio final, ganancias, cliente, stock, compras externas, importación sin duplicados y permisos. Su transacción termina con `ROLLBACK`; no conserva ventas de prueba ni avanza la numeración.

`tests/deletion.sql` comprueba eliminación, recuperación del stock público, ganancias, reintentos sin duplicar stock, reventa de unidades recuperadas, boletas anteriores sin inventario, conservación de compras externas, correo en curso y permisos. También termina con `ROLLBACK`.

`tests/activation.sql` comprueba contra PostgreSQL que activar el descuento automático registra la cantidad del catálogo anterior como unidades reales sin costo (sin duplicar en reintentos), que una venta en boleta o en Compras baja el stock publicado y que eliminar la boleta lo devuelve. Termina con `ROLLBACK`.

`tests/receipt-numbering.test.cjs` comprueba que tras emitir se abre la boleta siguiente solo cuando corresponde (no al reabrir una boleta del historial) y que se conserva el aviso de la boleta anterior.

`tests/picker.browser.test.cjs` usa la app real de `dist/` en Chromium con un Supabase simulado: agregar de un clic sin formulario, activar un producto del catálogo anterior, vincular unidades importadas conservando su costo, el aviso al escribir a mano un producto de la web, unidades ya vendidas, cancelar la activación masiva, avance de numeración sin bloquear los botones y errores del servidor visibles. Requiere Playwright (`npm i -g playwright` y su Chromium); si no está instalado, se omite.

`tests/receipt-history.test.cjs` comprueba abrir/cancelar/confirmar la eliminación desde la página, errores visibles, reintentos, solicitudes duplicadas, fallos de recarga y cierre de sesión durante una petición.

`tests/stock.sql` comprueba cantidades iniciales, reposición, productos agotados, correcciones sin alterar costos históricos, ventas de unidades retiradas rechazadas, reintentos, cantidades desactualizadas, compras en dólares con gastos, reversión de boletas y permisos. Termina con `ROLLBACK` y no conserva datos de prueba. Las pruebas de JavaScript verifican filtros, costos, validación de cantidades y propagación/persistencia del tema.

Se verifican scripts, referencias de archivos y funciones de base de datos. En esta ejecución no se dispone de un navegador de prueba para comprobar visualmente todos los tamaños de pantalla.
