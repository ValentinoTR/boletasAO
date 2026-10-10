# AO Nexus Central

Compras, inventario, ventas, boletas, clientes y productos de la tienda pública comparten una base de datos. El panel conserva el formato PDF y la configuración de correo de Boletas AO.

## Uso

1. Ingresar con la cuenta de Boletas AO.
2. En **Conexión inicial**, importar las compras del contabilizador anterior con su correo y contraseña. La sesión de importación es temporal y la contraseña no se almacena. La importación repetida solo incorpora registros nuevos.
3. En **Mi web → Compartir stock**, relacionar cada producto publicado con sus unidades reales de inventario. Revisar la cantidad antes de confirmar. El precio publicado se guarda por separado.
4. Al crear una boleta, seleccionar las unidades disponibles o registrar los productos comprados a otra tienda para esa venta. El conjunto de una PC puede imprimirse como una sola computadora.
5. Escribir el precio final de la boleta. Si cambia respecto de los precios de sus componentes, se distribuye entre ellos conservando cada céntimo. Los costos quedan guardados para calcular la ganancia.
6. Al emitir, la boleta, el comprador y la venta se guardan juntos. Las unidades dejan de estar disponibles. Descargar o reenviar una boleta emitida conserva el mismo registro.
7. Para corregir una boleta equivocada, abrir **Boletas emitidas → Eliminar** y confirmar. Desaparece del historial y de las ventas; sus unidades vuelven al inventario y se recalcula la ganancia. Las compras externas se conservan como compras reales, con sus unidades disponibles para otra venta. Después se puede emitir la boleta correcta. El número eliminado queda reservado; los correos ya enviados y los PDF descargados no se retiran.
8. **Mi web** e **Inventario** abren en **En stock**. Los productos agotados se conservan en **Para reponer**. **Modificar stock** corrige la cantidad disponible; una reducción retira unidades sin borrar la compra ni cambiar costos o ganancias anteriores. **Reponer** registra una nueva compra con cantidad, costo por unidad, proveedor y fecha.
9. **Agregar producto** pregunta cuántas unidades ingresan y su costo. Con cantidad 0, guarda la ficha y la foto para una reposición futura. Al registrar una compra también se pide cantidad y se puede asociar al producto de la web. El costo de esa compra es el total, con su cambio, impuestos y envío; para combos de piezas distintas se indica 0 y se agregan los componentes con sus cantidades.
10. El botón **Modo claro / Modo oscuro** aplica la elección al panel, formularios, boletas, tablas y ventanas. Se recuerda al volver a entrar. La tienda pública tiene su propio botón y recibe el tema elegido al abrirla desde el panel. El PDF conserva su formato original para impresión.

El catálogo existente mantiene sus cantidades anteriores hasta que se vinculan unidades. Las compras privadas del proyecto anterior requieren la cuenta de ese contabilizador para importarse.

## Código

- `build_suite.py`: adapta las aplicaciones conservadas en `original/` y genera el panel en `dist/`.
- `build_stock.py`: incorpora cantidades, reposición y controles de tema al generar el panel.
- `dist/assets/suite.js`: catálogo, clientes, selección de componentes e importación.
- `dist/assets/suite-core.js`: cálculos y reparto de precios en céntimos.
- `database/suite.sql`: esquema inicial y funciones del inventario compartido; ya aplicado al proyecto de Boletas AO. No ejecutarlo otra vez como un cambio incremental.
- `database/delete_receipts.sql`: actualización de eliminación del historial y reversión atómica de ventas; ya aplicada al proyecto actual. Conserva internamente el número y el registro original para impedir reintentos y duplicados. Solo el equipo con acceso activo puede eliminar.
- `database/receipt_allocator.sql`: numerador de boletas con bloqueo de reintentos de registros eliminados.
- `database/stock_management.sql`: actualización ya aplicada para cantidades, compras atómicas, correcciones y reposición con permisos de equipo y protección contra reintentos duplicados. Las unidades retiradas se conservan para no redistribuir el costo de compra.
- `dist/assets/theme.js`, `theme.css` y `receipt-theme.css`: tema compartido por las secciones y marcos del panel.
- `supabase/functions/ao-api/`: función de correo actualizada; bloquea el envío de boletas eliminadas.
- `build_integrations.py`: prepara el catálogo público y las entradas hacia el panel central.
- `integrations/contabilizador/legacy.html`: copia del contabilizador anterior para consulta durante la transición.

Las fotos nuevas se guardan en `ao-product-images`. El catálogo público recibe solo productos, precios, fotos y disponibilidad mediante `ao_catalog_snapshot`. Los costos, clientes y boletas requieren pertenecer al equipo autenticado.

## Validación

```sh
python build_suite.py
python build_integrations.py
python tests/check_assets.py
node --test tests/core.test.cjs tests/catalog.test.cjs tests/stock.test.cjs tests/theme.test.cjs
```

`tests/transactions.sql` prueba contra PostgreSQL precio final, ganancias, cliente, stock, compras externas, importación sin duplicados y permisos. Su transacción termina con `ROLLBACK`; no conserva ventas de prueba ni avanza la numeración.

`tests/deletion.sql` comprueba eliminación, recuperación del stock público, ganancias, reintentos sin duplicar stock, reventa de unidades recuperadas, boletas anteriores sin inventario, conservación de compras externas, correo en curso y permisos. También termina con `ROLLBACK`.

`tests/stock.sql` comprueba cantidades iniciales, reposición, productos agotados, correcciones sin alterar costos históricos, ventas de unidades retiradas rechazadas, reintentos, cantidades desactualizadas, compras en dólares con gastos, reversión de boletas y permisos. Termina con `ROLLBACK` y no conserva datos de prueba. Las pruebas de JavaScript verifican filtros, costos, validación de cantidades y propagación/persistencia del tema.

Se verifican scripts, referencias de archivos y funciones de base de datos. En esta ejecución no se dispone de un navegador de prueba para comprobar visualmente todos los tamaños de pantalla.
