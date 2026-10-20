# Modelo de despliegue: Cloudflare Workers, Tunnel y VPS OVH

## Estado

**Decidida e implementada** el 2026-10-20. La release desplegada usa la etiqueta
`2026-10-20-r1` en `api`, `migrate` y `seed`. La decision arquitectonica esta en
`docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.

## Topologia

```text
Navegador
  -> Cloudflare (TLS, DNS, Access en Grafana)
  -> Worker Static Assets (sipeg-utp.com)
  -> Cloudflare Tunnel (api.sipeg-utp.com, grafana.sipeg-utp.com)
  -> cloudflared en el VPS
  -> api:3000 / grafana:3000 (redes Docker internas)
```

| Hostname                | Destino               | Proteccion                        |
| ----------------------- | --------------------- | --------------------------------- |
| `sipeg-utp.com`         | Worker Static Assets  | Publico                           |
| `api.sipeg-utp.com`     | `http://api:3000`     | Publico; CORS y rate limiting     |
| `grafana.sipeg-utp.com` | `http://grafana:3000` | Cloudflare Access + login Grafana |

El frontend se despliega en un repositorio separado. Este backend no contiene el
Worker ni su configuracion de build.

## Componentes

- **Frontend:** React con Vite compilado a estaticos y publicado en Cloudflare
  Workers Static Assets. El build usa
  `VITE_API_BASE_URL=https://api.sipeg-utp.com`.
- **Frontera publica:** Cloudflare termina TLS, aplica DNS proxied, Always Use
  HTTPS y Access solo a Grafana. API y Grafana tienen una regla de bypass de
  cache.
- **Tunel:** `cloudflared` corre como servicio Compose con el tunel nombrado
  `sipeg-produccion`. Solo necesita conexiones salientes; no se abren puertos
  HTTP/HTTPS entrantes en el VPS.
- **Origen:** VPS OVH en Beauharnois con Ubuntu 24.04, Docker Engine y Compose.
  Ejecuta la API, PostgreSQL, el stack de observabilidad y el conector.
- **Correo:** Brevo por SMTP en `smtp-relay.brevo.com:587` con STARTTLS
  (`MAIL_SECURE=false`). Remitente `SIPEG UTP <no-reply@sipeg-utp.com>`.

## Decisiones resueltas

| #   | Decision                                      | Valor final                                                                    |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Dominio registrable de API y frontend         | `sipeg-utp.com`                                                                |
| 2   | `AUTH_REFRESH_COOKIE_SAME_SITE`               | `lax`                                                                          |
| 3   | `Secure` de cookies                           | `true` en produccion                                                           |
| 4   | Frontera confiable y cadena `X-Forwarded-For` | `trust proxy=1`; `cloudflared` es el unico salto                               |
| 5   | `CORS_ORIGIN` y `TRUSTED_ORIGINS`             | `https://sipeg-utp.com`; `TRUSTED_ORIGINS` vacio                               |
| 6   | `AUTH_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`    | `https://api.sipeg-utp.com`                                                    |
| 7   | `VITE_API_BASE_URL`                           | `https://api.sipeg-utp.com`                                                    |
| 8   | TLS                                           | Cloudflare; Always Use HTTPS; origen HTTP dentro del tunel                     |
| 9   | Logs de acceso del proxy                      | Cloudflare Analytics; Alloy recoge logs de contenedores, no del edge           |
| 10  | Backup y restore de PostgreSQL                | Resuelta: `deploy/backup/` con cifrado AES-256, retencion 14 dias, restore de prueba y timer diario; offsite pendiente (R2, fase 6) |
| 11  | Migraciones por despliegue                    | `migrate` y `seed` one-shot antes de arrancar la API                           |
| 12  | Acceso operativo a Grafana                    | Access (team `sipeg`) + login de Grafana; loopback para diagnostico local      |
| 13  | `AUTH_JWKS_URL`                               | `http://127.0.0.1:3000/api/auth/jwks`                                          |
| 14  | Imagen de la API                              | `IMAGE_TAG` obligatoria; no se reutiliza una etiqueta para codigo distinto     |
| 15  | Correo transaccional                          | Brevo, puerto `587`, STARTTLS                                                  |
| 16  | Aislamiento de buckets de rate limiting       | Configurado por IP; prueba desde dos redes **diferida** por decision operativa |

## Cloudflare

- Los registros `api` y `grafana` son CNAME proxied hacia el tunel.
- **Always Use HTTPS** esta activo en la zona.
- La regla de cache se aplica a ambos hostnames:

```text
(http.host eq "api.sipeg-utp.com") or (http.host eq "grafana.sipeg-utp.com")
```

- Access protege solo `grafana.sipeg-utp.com`, con una politica Allow limitada a
  los correos administradores. La API no usa Access.
- Bot Fight Mode puede permanecer activo. El verificador JWT de Node no depende
  del JWKS publico; usa el endpoint interno.
- El JWKS publico se comprueba aparte: responde `200` con clave EdDSA y
  `cf-cache-status: DYNAMIC`.

## Compose y redes

El despliegue combina tres archivos, en este orden:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  up -d --build
```

Servicios resultantes:

- `migrate`: aplica migraciones y termina.
- `seed`: carga el catalogo base y el ADMIN inicial si aplica; termina.
- `db`: PostgreSQL, sin puertos publicados.
- `api`: arranca solo si `migrate` y `seed` terminaron correctamente.
- `loki`, `docker-socket-proxy`, `alloy`, `grafana`: observabilidad.
- `cloudflared`: conector del tunel.

Redes:

- `sipeg-utp-prod`: `api`, `db` y `cloudflared`.
- `observability`: `loki`, `alloy`, `docker-socket-proxy`, `grafana` y
  `cloudflared`.
- `cloudflared` es el unico servicio en ambas redes. Alcanza `api:3000` y
  `grafana:3000` sin publicar puertos.
- Alloy consulta Docker a traves de `docker-socket-proxy` de solo lectura; nunca
  monta `/var/run/docker.sock` directamente.

Puertos en el host:

- `api`: `127.0.0.1:3000`, solo diagnostico.
- `grafana`: `127.0.0.1:3001`, solo diagnostico.
- `db`: ninguno.
- `loki`, `alloy` y `docker-socket-proxy`: solo `expose` en su red.

## Cookies, CORS y proxy

`sipeg-utp.com`, `api.sipeg-utp.com` y `grafana.sipeg-utp.com` comparten el dominio
registrable, asi que API y frontend son same-site. Por eso:

- `AUTH_REFRESH_COOKIE_SAME_SITE=lax`.
- La cookie `sipeg-refresh` es `HttpOnly`, `Secure`, host-only (sin `Domain`) y
  `Path=/api/v1/auth`.
- `strict` romperia la sesion cuando el usuario llega desde el enlace del correo
  de verificacion o de reset.
- El access token sigue en el cuerpo como JWT EdDSA y se envia como
  `Authorization: Bearer`.

`app.set('trust proxy', 1)` confia en el salto del socket. En esta topologia el
socket lo aporta `cloudflared`; Cloudflare escribe la IP del cliente al final de
`X-Forwarded-For`. Si se añade otro proxy o se cambia la cadena, hay que revisar
`trust proxy` y la agrupacion de los buckets de rate limiting.

## JWKS interno

`AUTH_JWKS_URL` apunta al loopback del propio contenedor de la API:

```dotenv
AUTH_JWKS_URL=http://127.0.0.1:3000/api/auth/jwks
```

Esto evita la ida y vuelta por Internet y los challenges de Bot Fight Mode que un
cliente Node no puede resolver. `AUTH_URL`, `AUTH_ISSUER` y `AUTH_AUDIENCE`
conservan sus valores publicos; cambiar el transporte del JWKS no cambia la
identidad de los tokens ni elimina la verificacion de firmas.

`authJwksReachable` mide el endpoint configurado con un limite de 3 segundos. En
Docker no acredita la disponibilidad del tunel ni del JWKS publico. Esa ruta se
comprueba desde fuera y se prueba una peticion protegida desde el navegador.

## Despliegue y operacion

1. Validar la configuracion sin imprimir secretos:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  config --quiet
```

2. Construir y levantar:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  up -d --build
```

3. Revisar servicios:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  ps -a
```

Esperado: `db` saludable; `migrate` y `seed` con `Exited (0)`; `api`,
observabilidad y `cloudflared` en ejecucion; tunel **Healthy** en Cloudflare.

`.env.prod` es privado, no se versiona, pertenece al operador y debe tener permisos
`600`:

```bash
chmod 600 .env.prod
stat -c '%a %U:%G' .env.prod
```

Despues de confirmar el ADMIN, vaciar `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL` y
`SEED_ADMIN_IDENTIFICATION_NUMBER` en `.env.prod`. El seed conserva el ADMIN
existente.

## Verificacion

```bash
curl -i https://api.sipeg-utp.com/api/v1/health
curl -i https://api.sipeg-utp.com/api/auth/jwks

curl -i -X OPTIONS \
  https://api.sipeg-utp.com/api/v1/auth/login \
  -H 'Origin: https://sipeg-utp.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Esperado: health `200` con `authJwksReachable: true`; JWKS `200` con clave EdDSA;
preflight `204` con `Access-Control-Allow-Origin: https://sipeg-utp.com` y
`Access-Control-Allow-Credentials: true`.

Comprobaciones funcionales realizadas:

- Registro, recepcion real por Brevo y verificacion de email.
- Login, refresh, recarga y segunda pestana.
- Recuperacion y cambio de contrasena.
- Cookie `sipeg-refresh` con sus atributos.
- Grafana exige Access, permite el login y consulta Loki con logs de la API.
- Reinicio del VPS con recuperacion automatica y health correcto.
- Desarrollo con Mailpit.

## Pendientes operativos

- **Rate limiting:** el aislamiento de buckets entre dos redes no se probo para no
  bloquear la IP del operador. Queda diferido; no bloquea el criterio de
  finalizacion del despliegue. Debe repetirse antes de ajustar umbrales con
  trafico real.
- **Backup/restore:** resuelto en `deploy/backup/`: backup diario cifrado,
  retencion de 14 dias, restore de prueba automatizado y timer verificado. Es
  solo local por decision operativa; el offsite queda pendiente (R2, fase 6).
- **Alertas de Grafana:** resuelto: SMTP de Grafana, contact point
  `sipeg-email`, politica por defecto, regla de disco y correo de prueba
  recibido. Ver `docs/adr/adr-0013-vps-hardening-baseline.md`.
- **Logs del proxy:** el edge no escribe en Loki; su analitica vive en Cloudflare.
- **Rotacion de secretos:** documentar y probar la rotacion de `AUTH_SECRET`,
  `LOG_PSEUDONYMIZATION_KEY`, credenciales SMTP y token del tunel.

## Referencias

- `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.
- `docs/adr/adr-0007-structured-logging-and-observability.md`.
- `docs/adr/adr-0009-refresh-token-cookie-httponly.md`.
- `compose.prod.yaml`, `compose.observability.yaml`, `compose.cloudflare.yaml`.
- `.env.prod.example`.
- [Cloudflare Tunnel: routing](https://developers.cloudflare.com/tunnel/concepts/routing/).
- [Cloudflare Tunnel: conectividad y puertos salientes](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).
- [Cloudflare Access: aplicacion autohospedada](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
- [Express detras de proxies](https://expressjs.com/en/guide/behind-proxies).
