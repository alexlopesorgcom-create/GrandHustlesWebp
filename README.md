# DRPHVN — Estado de implementación y lanzamiento

Esta rama es una **versión de trabajo**. No fusionar con `main` ni aceptar pagos reales hasta completar las pruebas.

## Cambios realizados
- Marca DRPHVN y mejoras de carrito responsive.
- El backend consulta precios y stock desde Firestore y rechaza líneas duplicadas.
- Checkout crea pedidos con ID único, sin sobrescribir un pedido existente.
- El webhook valida la firma de Stripe y actualiza stock y pedido en una transacción; los reintentos no descuentan dos veces.
- Registro de notificaciones internas `notifications/paid_<orderId>` (no son correos enviados).
- `firebase-admin` declarado como dependencia del servidor.
- Se desactivó el administrador del navegador basado en contraseña fija y Zelle hasta asegurar el flujo.

## Bloqueos para producción
1. **Firestore Security Rules**: revisar reglas activas. El navegador lee `products` y el código anterior escribía `products` y `orders` directamente. Se deben **denegar escrituras anónimas** y usar Firebase Authentication y roles/claims para admin; no aplicar reglas sin verificar los datos y el flujo real.
2. **Checkout e inventario**: no hay reserva de inventario antes de cobrar. Dos clientes pueden pagar la última unidad; el webhook reintentará pero no reembolsa automáticamente. Se requiere diseño de reservas de stock o conciliación/reembolso operado por el dueño antes de vender.
3. **Stripe**: confirmar `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, URL de webhook, modos test/live y eventos. El frontend actualmente tiene clave pública LIVE; para pruebas debe usarse clave pública TEST junto con secreto TEST.
4. **Firebase Admin**: configurar `FIREBASE_SERVICE_ACCOUNT` como JSON de cuenta de servicio en las variables de entorno de Vercel (jamás en GitHub). Verificar proyecto `mi-tienda-drop`.
5. **Emails**: aún no hay proveedor de correo transaccional ni credenciales verificadas. No afirmar que se envían correos de pedidos.
6. **Admin**: requiere interfaz autenticada y operaciones autorizadas en backend; temporalmente desactivado.
7. **Imágenes**: migrar imágenes base64 de documentos Firestore a Firebase Storage o servicio de imágenes; evitar superar límites de tamaño de documentos.
8. **Catálogo**: tamaños S/M/L/XL se muestran, pero todavía no están ligados a inventario por variante ni a cada línea del carrito.
9. **Pagos**: completar el manejo de 3D Secure y la confirmación posterior al webhook. El navegador no es la fuente definitiva de pago.
10. **Despliegue**: conectar rama de pruebas con Vercel Preview y verificar build, variables, Firestore, endpoints y compra simulada. No hay evidencia de despliegue exitoso desde esta rama.

## Pruebas obligatorias antes del lanzamiento
- Compra test aprobada, rechazada y con autenticación 3DS.
- Reenvío del mismo webhook: stock descontado solo una vez.
- Intento de modificar precio, cantidad, ID y total desde navegador.
- Compra simultánea de la última unidad: no aceptar dos pedidos sin resolver el conflicto.
- Acceso anónimo: puede leer productos públicos, **no** puede crear/borrar productos ni modificar pedidos.
- Pruebas móvil, carrito, errores de red, stock agotado y restauración de pedidos.
- Verificación de notificaciones y correo real (solo cuando exista proveedor).

## Variables esperadas
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`.

**Importante:** no subir secretos, claves privadas ni contraseñas al repositorio. Las claves públicas de Firebase/Stripe no reemplazan la seguridad de las reglas y del servidor.

## Política de lanzamiento
Mantener la rama `feature/drphvn-safe-rebuild-oct2026` como trabajo aislado y revisar mediante PR/Preview. Publicar solo tras pruebas de extremo a extremo y aprobación explícita del propietario.
