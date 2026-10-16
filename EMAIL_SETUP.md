# DRPHVN: estado y activación de correos (2026-10-15)

Esta rama NO está autorizada para producción. El procesador está apagado por defecto.
No se ha configurado ninguna variable en Vercel ni enviado correo real.

## Implementación
- Webhook firmado: guarda dos trabajos deterministas dentro de la transacción que liquida el pedido y descuenta stock. Corregido el patrón de validación del correo.
- Procesador: `POST /api/process-email-outbox`, protegido por `Authorization: Bearer <EMAIL_WORKER_SECRET>` (mínimo 32 caracteres aleatorios).
- Comprueba pedido liquidado y consulta el PaymentIntent en Stripe: ID, estado, metadata, importe, importe recibido, moneda y modo test/live.
- Bloqueo transaccional de 60 segundos, cuerpo del correo persistido antes del envío, clave de idempotencia estable y reintentos con espera creciente.
- Resend conserva idempotencia durante 24 horas: tras 23 horas desde el primer intento el trabajo pasa a `review`, sin reenvío automático. Nunca borrar el registro `sent` ni cambiar la clave para resolver una respuesta incierta.
- `sent` significa aceptado por Resend, NO entrega comprobada en bandeja. La entrega necesita revisión del panel o integración futura de eventos de Resend.
- Los trabajos `review` requieren revisión humana. Los pedidos antiguos liquidados no se reconstruyen ni se reenvían automáticamente.
- No hay cron ni scheduler activo. El endpoint está preparado para invocación POST por un scheduler autorizado posteriormente. Verificar límites de duración de Vercel antes de activarlo; lotes acotados y presupuesto entre envíos de 20 segundos.
- Pagos y webhook bloqueados en Vercel Preview para evitar escribir en Firebase real o usar claves heredadas. El worker también bloquea Preview.
- `vercel.json` desactiva despliegues Git automáticos exclusivamente en esta rama.
- El servidor local ya usa las mismas validaciones que Vercel; exige clave Stripe test y emulador Firestore.

## Variables preparadas (NO configuradas en la cuenta)
| Variable | Valor inicial / tratamiento |
|---|---|
| EMAIL_OUTBOX_ENABLED | `false` hasta aprobar activación |
| EMAIL_MODE | `test` para pruebas, `live` solo tras autorización |
| OWNER_EMAIL | `drphvn.store@gmail.com` |
| EMAIL_TEST_RECIPIENT | `drphvn.store@gmail.com`, confirmar que es la cuenta Resend |
| EMAIL_REPLY_TO | `drphvn.store@gmail.com` |
| RESEND_FROM_EMAIL | `DRPHVN <onboarding@resend.dev>` para prueba sin dominio |
| RESEND_API_KEY | Secreto de servidor; nunca Git ni chat |
| EMAIL_WORKER_SECRET | Secreto aleatorio de servidor, mínimo 32 caracteres |
| STRIPE_SECRET_KEY | Conservar original en producción; pruebas con clave test |
| STRIPE_WEBHOOK_SECRET | El del endpoint correspondiente, nunca intercambiar test/live |
| FIREBASE_SERVICE_ACCOUNT | Conservar original; no usar para pruebas contra datos reales |

Las claves deben almacenarse como Secret en Vercel. No modificar Production hasta autorización.
Preview permanece bloqueado hasta diseñar/verificar su aislamiento. Para pruebas sin otra base real, usar Firestore Emulator local con datos ficticios.

## Resend sin dominio
El remitente `onboarding@resend.dev` permite pruebas al correo de la cuenta, no envíos generales a clientes. En modo test ambos correos se redirigen al destinatario de prueba y se rotulan PRUEBA; solo se aceptan PaymentIntents test.
No utilizar Gmail como dominio remitente. Gmail puede ser Reply-To.
Para clientes se requiere un dominio propio verificado por DNS; no se compró ni añadió ninguno.
Plan gratuito publicado: 3.000 correos/mes y 100/día. Dos correos por compra consumen dos envíos; verificar el plan real al acceder a la cuenta.
Referencias: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain ; https://resend.com/docs/dashboard/emails/idempotency-keys ; https://resend.com/pricing

## Pruebas y límites
`npm test`: 35 pruebas correctas; pruebas locales con Firestore y proveedores simulados, sin red ni credenciales.
Incluyen concurrencia, replay de webhook, firmas inválidas simuladas, importes/moneda/modo inconsistentes, reintentos, ventana vencida, destinatarios, modo desactivado y autenticación del endpoint.
NO sustituyen pruebas con Firestore Emulator, firma real del SDK Stripe, Stripe test, Resend ni Vercel desplegado.

## Bloqueos para vender
- `stockReservation.js` sigue sin integrarse al checkout. Sigue posible cobrar a dos compradores por la última unidad; no aprobar producción hasta resolver reserva, cancelación y conciliación.
- Falta autenticación administrativa y verificar las reglas Firestore desplegadas. Las reglas del repositorio deniegan acceso cliente a la cola por regla general, pero no prueban las reglas activas.
- Frontend conserva proyecto Firebase `mi-tienda-drop` y clave pública Stripe LIVE; no hacer checkout desde él durante pruebas.
- Vercel listó dos proyectos antiguos, pero rechazó lectura de detalles con HTTP 403 para el equipo `grand-hustles`. No fue posible comprobar cuál sirve producción, las variables ni sus valores. CLI no instalado.
- Resend requiere inicio de sesión; no se verificó plan, claves, dominios ni entregas de la cuenta.
- No se consultaron ni modificaron documentos de Firebase, configuración de Stripe o variables de Vercel. Preservar no equivale a haber auditado su contenido.

## Siguiente paso seguro
Completar acceso Resend y restablecer acceso al equipo Vercel; identificar proyecto y rama de producción. Probar con datos ficticios y emulador. Completar los bloqueos de checkout, verificar entrega al dueño con Stripe test y solicitar autorización antes de activar producción, scheduler o envíos a clientes.
