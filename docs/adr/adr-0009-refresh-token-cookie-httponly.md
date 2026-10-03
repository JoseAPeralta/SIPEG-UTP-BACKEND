---
title: 'ADR-0009: Refresh token en cookie HttpOnly en lugar del cuerpo de la respuesta'
status: 'Accepted'
date: '2026-09-30'
authors: 'Equipo backend SIPEG UTP'
tags: ['security', 'auth', 'cookies', 'csrf']
supersedes: ''
superseded_by: ''
---

# ADR-0009: Refresh token en cookie HttpOnly en lugar del cuerpo de la respuesta

## Status

**Accepted**

## Context

El endpoint de login y el de refresh devolvian el refresh token en el cuerpo JSON
y el frontend lo guardaba en `sessionStorage`. Eso rompia el caso de uso mas
frecuente del producto y era un riesgo:

- **La sesion no se compartia entre pestanas.** `sessionStorage` esta scopeado a
  una pestana: abrir una segunda pestana del mismo navegador exigia volver a
  iniciar sesion, aunque la credencial valida siguiera existiendo.
- **El token era accesible desde JavaScript.** Cualquier inyeccion de script en
  el origen del frontend podia leer `sessionStorage` y exfiltrar una credencial
  de larga duracion (7 dias por defecto). La cookie `HttpOnly` hace que el
  navegador no la exponga al JavaScript de la pagina.
- El cierre de sesion en una pestana no informaba a las demas, que seguian con
  un access token valido en memoria hasta que expiraba.

## Decision

El refresh token viaja en una cookie y **no** aparece en ningun cuerpo de
respuesta.

### Atributos de la cookie

| Atributo   | Valor                           | Motivo                                                      |
| ---------- | ------------------------------- | ----------------------------------------------------------- |
| Nombre     | `sipeg-refresh`                 | Nombre explicito del proyecto.                              |
| `HttpOnly` | obligatorio                     | JavaScript no puede leerla; mitiga robo por XSS.            |
| `Path`     | `/api/v1/auth`                  | Limita la exposicion: no viaja a las peticiones de negocio. |
| `Domain`   | ausente                         | Host-only. Evita ampliar el alcance a subdominios hermanos. |
| `Secure`   | `true` en produccion            | Obligatorio con `SameSite=None`.                            |
| `SameSite` | `AUTH_REFRESH_COOKIE_SAME_SITE` | Ver decision de topologia.                                  |
| `Max-Age`  | expiracion real de la sesion    | La cookie no sobrevive a la sesion que representa.          |

El cuerpo de `AuthTokens` queda en `accessToken`, `accessTokenExpiresAt`,
`refreshTokenExpiresAt` y `tokenType`. El access token sigue siendo un JWT
EdDSA de vida corta en el cuerpo, porque el frontend lo envia como
`Authorization: Bearer` y necesita leerlo.

### Decision de topologia

`SameSite` depende de si la API y el frontend comparten sitio, y no se puede
suponer:

- Mismo sitio (`api.example.edu` y `app.example.edu`): `lax` o `strict`.
- Sitios distintos (`api.example.com` y `app.example.org`): `none`, que exige
  `Secure` y por tanto HTTPS real.

Por eso `AUTH_REFRESH_COOKIE_SAME_SITE` es **obligatoria en produccion**. En
desarrollo vale `lax` por defecto. `none` se rechaza fuera de produccion porque
seria una cookie marcada `Secure` sin HTTPS, que el navegador descarta.

Este ADR deja la eleccion de topologia deliberadamente abierta: no presupone si
la API y el frontend compartiran dominio registrable. La eleccion, su
recomendacion y las decisiones derivadas estan en `docs/despliegue.md`.

### Defensa CSRF

Una cookie se envia sola, asi que un endpoint que la consume puede quedar
expuesto a CSRF. `requireTrustedOrigin` protege login, refresh, logout y
change-password:

- Si la peticion trae `Origin`, debe estar en la lista de origenes confiados; si
  no, responde 403 y registra `security.cors.denied`.
- Si no trae `Origin`, se permite. Es lo que hacen `curl`, Postman y Bruno, que
  no pueden enviarlo de forma fiable.

Esto cubre los navegadores. Un cliente no navegador puede saltarselo, pero tambien
puede hacer bromas peores: quien tiene el token puede usarlo directamente. El
modelo real es que la cookie es la credencial y quien la posee es el titular.

### Limite de peticiones

El refresh se limita por sesion en lugar de por IP. Antes heredaba el limite de
login (5/min), que en una institucion concentre a varios usuarios tras una misma
IP publica se traducía en un cierre de sesion masivo y no en una contencion real
del abuso.

### Sesion compartida y cierre efectivo

La cookie pertenece al host y path dentro del perfil del navegador, no a una
pestana ni a un puerto. En localhost, dos APIs con puertos distintos y el mismo
nombre/path de cookie pueden sobrescribir la misma credencial. `127.0.0.1` y
`localhost` no comparten cookie. Para cuentas independientes se usan perfiles
separados; las llamadas del navegador incluyen `credentials: "include"`.

`refresh` y `logout` admiten cuerpo omitido. Logout responde 200 y expira la
cookie incluso cuando no se envia o la sesion ya no existe. Si la revocacion
falla en el servidor, responde 500 y conserva la cookie para reintentar: no se
anuncia un cierre exitoso. Borrar solo el estado local no revoca la sesion.
Login, refresh y logout incluyen `Cache-Control: no-store`.

La revocacion impide renovar esa sesion desde cualquier pestana que la comparta,
pero los access JWT ya emitidos siguen vigentes hasta expirar. La actualizacion
inmediata de la interfaz y el descarte del access token en las otras pestanas
requieren coordinacion del cliente.

## Consequences

### Positive

- La sesion se comparte entre pestanas sin volver a iniciar sesion.
- Un XSS ya no puede exfiltrar la credencial de larga duracion.
- Un logout exitoso revoca la sesion de refresh compartida por las pestanas.

### Negative

- `fetch` necesita `credentials: "include"`; sin el, la cookie no viaja y el
  refresh falla con 401.
- El cliente no puede leer la expiracion de la cookie, solo la del cuerpo.
- Se necesita HTTPS y `SameSite` bien elegido en produccion.
- Un cliente no navegador debe saber reenviar la cabecera `Cookie`.
- La cookie no se puede invalidar desde el cliente al instante, como permitia
  borrar `sessionStorage`.

### Neutral

- El access token sigue siendo stateless y de vida corta. Esta decision no
  cambia el modelo de autorizacion: solo como se porta la credencial de refresh.
- No hay periodo de compatibilidad. La API no estaba desplegada, asi que el
  contrato se cambio de golpe en lugar de aceptar ambos formatos durante una
  ventana de transicion.

## Alternatives considered

- **Mantener `sessionStorage` y sincronizar entre pestanas.** Habria exigido
  reescribir la cookie hacia cada pestana con eventos de `storage`, que es
  precisamente lo que `HttpOnly` evita, y el token seguiria expuesto a
  JavaScript.
- **Refresh token en `localStorage`.** Sobrevive al cierre del navegador y es
  legible por JavaScript, con lo que empeoran los dos problemas.
- **Cookie de sesion classic con `SameSite` fijo.** Habria obligado a elegir una
  topologia en el momento del despliegue en lugar de hacerlo por configuracion.
- **Ventana de compatibilidad con ambos formatos.** Habria duplicado el codigo de
  los cuatro endpoints para un despliegue que no existe.

## Related

- `src/modules/auth/auth.cookie.ts`
- `src/middlewares/trustedOrigin.middleware.ts`
- `docs/despliegue.md`: eleccion de topologia y valor final de `SameSite`.
- `docs/adr/adr-0007-structured-logging-and-observability.md`: el proxy TLS que
  termina HTTPS y la condicion de un solo salto.
