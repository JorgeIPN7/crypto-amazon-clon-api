# Changelog

Todo lo notable de Amazon clon | Crypto se registra aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
[Semantic Versioning](https://semver.org/lang/es/).

El historial del template del que nace este proyecto está archivado en
[`docs/template-history/changelog.md`](./docs/template-history/changelog.md).

---

## [Unreleased]

### Añadido

- **Bounded context `wallets`: una dirección Ethereum custodiada por usuario, sobre Tatum Gas Pump.**
  Cinco endpoints, todos autenticados: `POST /wallets` (alta idempotente, **200 y no 201**),
  `GET /wallets/me`, `POST /wallets/me/activation` (**202**: la transacción está enviada, no minada),
  `POST /wallets/me/transfers` y `GET /wallets/me/transfers` (paginado).
- **Libro de transferencias con escritura POR DELANTE** (`wallet_transfers`): la fila existe antes de
  llamar al proveedor, así que un timeout deja rastro. Tres desenlaces —`submitted`, `rejected` y
  `unknown`—, y el motivo del fallo es un código de lista cerrada, nunca el mensaje del proveedor.
- **Migración `1787900000000-create-wallets`**: dos tablas, tres índices únicos, el índice compuesto
  del listado, una `SEQUENCE` para los índices de dirección y el **primer `CHECK` del esquema**.
- **Validación de checksum EIP-55** en el borde HTTP, con `@noble/hashes`.
- **Comprobación de arranque** que deriva la dirección de la master desde su clave privada y aborta
  si no corresponden, con `@noble/curves`.
- `@noble/hashes` y `@noble/curves` en `dependencies` — se ejecutan en tiempo de petición.

### Seguridad

- **`mainnet` está vetada en el arranque** por un `refine()` de `env.schema.ts`. Toda transferencia
  firma con una clave privada cruda en el cuerpo, que el proveedor documenta como testnet-only.
  ⚠️ **Este código no puede ir a producción sin otro ciclo**: la salida es el KMS del proveedor, y
  eso cambia la firma del puerto.
- **Tres rutas de redacción nuevas** en el logger para la clave privada de la master, más un spec
  que MIDE la fuga en cuatro superficies —incluida una línea real de pino— en vez de afirmarla.
- **Una sola EOA en el sistema, la del admin**, con cinco controles independientes.
  ⚠️ Esa dirección NO está en la tabla `wallets`: responder «qué direcciones controlamos» exige
  mirar la tabla **y** la configuración.

### Cambiado

- `VERIFIED_ERROR_STATUSES` incluye 502 y 503, contrastados antes contra `AllExceptionsFilter`.
- La lista cerrada del selector de `type` inline de `eslint.config.mjs` pasa de siete a once nombres.
- `.gitleaksignore` documenta por qué caduca solo y lleva los fingerprints de los DOS modos de
  escaneo, que no comparten numeración.
