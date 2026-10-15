# DRPHVN — Protocolo de pruebas antes de vender

**Estado: NO APTO PARA COBROS REALES.** Este documento no certifica pruebas ejecutadas. La rama de trabajo no debe fusionarse ni desplegarse a producción sin revisión y autorización del propietario.

## Preparación de entorno aislado
1. Usar proyecto Firebase de pruebas separado de producción, con productos ficticios y stock de prueba.
2. Configurar Vercel Preview con FIREBASE_SERVICE_ACCOUNT de pruebas, STRIPE_SECRET_KEY=sk_test_..., STRIPE_WEBHOOK_SECRET=whsec_... del endpoint de pruebas.
3. **Cambiar la clave pública del frontend de pk_live_... a pk_test_... correspondiente.** No combinar claves live/test. No publicar datos privados.
4. Registrar en Stripe test webhook POST /api/webhook para payment_intent.succeeded y payment_intent.payment_failed.
5. Comprobar que Firestore Rules de pruebas deniegan escrituras anónimas a products, orders y notifications, permitiendo lectura pública de products si procede.
6. Confirmar que las pruebas no crean pagos live ni alteran el inventario real.

## Matriz mínima de pruebas
| Caso | Resultado esperado |
|---|---|
| Acceso VIP correcto/incorrecto, teclado y móvil | Animación sin bloqueo; acceso incorrecto no abre |
| Añadir, aumentar, disminuir y borrar productos | Cantidades y total consistentes; no excede stock visible |
| Carrito vacío | Animación y enlace funcional al catálogo; checkout deshabilitado |
| Producto inactivo o precio/stock inválido | No se ofrece a la venta |
| Precio, cantidad o total alterado en petición | HTTP 400, sin PaymentIntent |
| Mismo checkoutId enviado dos veces | No se duplica el pedido ni el cobro |
| Pago test aprobado | Pedido y pago se concilian; stock se descuenta una sola vez |
| Webhook duplicado | No se descuenta stock otra vez |
| Tarjeta test rechazada | Pedido no se marca Paid |
| Tarjeta test 3D Secure | El flujo de autenticación se completa y concilia |
| Webhook con firma inválida | HTTP 400 |
| Webhook con cuerpo mayor a 1 MiB | HTTP 413 |
| Red desconectada / respuesta no JSON | Mensaje útil, sin declarar éxito |
| Dos compradores por última unidad | **BLOQUEANTE**: no lanzar hasta implementar reserva de stock o manejo seguro de sobreventa/reembolso |
| Correo cliente y dueño | **BLOQUEANTE** hasta proveedor transaccional y pruebas reales |
| Administración de catálogo | **BLOQUEANTE** hasta autenticación y autorización del servidor |

## Bloqueos técnicos conocidos
- No hay reserva transaccional de inventario **antes** del cobro: el webhook puede fallar después de un pago válido por falta de stock.
- No hay sistema de expiración y liberación de reservas.
- Un fallo de Stripe después de crear la orden puede dejar checkoutId bloqueado; requiere recuperación/consulta segura del pedido.
- No hay emails transaccionales reales ni panel de administración autenticado.
- Las variantes S/M/L/XL no están representadas como stock independiente.
- El código de acceso VIP del navegador es visual, no autenticación ni control de acceso seguro.
- La clave pública Stripe incluida actualmente en index.html es LIVE: **no probar pagos con ella**.
- No se ha validado en un navegador de preview ni con Stripe/Firebase test desde este trabajo.

## Criterio de salida
No marcar como listo hasta completar todos los casos bloqueantes, revisar registros de Stripe y Firestore, probar móvil/escritorio y obtener aprobación explícita para desplegar.
