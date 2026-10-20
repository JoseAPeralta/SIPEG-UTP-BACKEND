---
title: 'ADR-0012: Despliegue con Cloudflare Workers y Tunnel sobre VPS OVH'
status: 'Accepted'
date: '2026-10-20'
authors: 'Equipo backend SIPEG UTP'
tags: ['deployment', 'cloudflare', 'tunnel', 'security']
supersedes: ''
superseded_by: ''
---

# ADR-0012: Despliegue con Cloudflare Workers y Tunnel sobre VPS OVH

## Status

**Accepted** — implementado y verificado el 2026-10-20. Actualiza parcialmente
ADR-0007 (terminacion TLS y frontera publica) y ADR-0009 (topologia y valor de
`SameSite`).

## Context

- El frontend es una aplicacion React con Vite que se compila a archivos estaticos
  en un repositorio separado. El backend es la unica fuente de datos y expone una
  API REST versionada.
- La API necesita PostgreSQL, migraciones, seed, correo transaccional, logs
  estructurados, Loki, Alloy y Grafana. Todo ese estado se opera en un unico VPS
  OVH en Beauharnois, con Docker Engine y Compose.
- No se quieren abrir puertos HTTP/HTTPS entrantes ni operar certificados TLS en
  el VPS. La frontera publica debe terminar TLS, filtrar trafico y permitir
  publicar la API sin exponer la IP del origen.
- API y frontend deben compartir el dominio registrable `sipeg-utp.com` para que
  la cookie de refresco funcione con `SameSite=Lax`. La sesion se basa en una
  cookie `HttpOnly`; el access token sigue siendo un JWT de vida corta.
- Grafana expone logs que pueden incluir eventos de seguridad. No puede quedar
  publico sin autenticacion adicional.
- El correo de identidad debe entregarse a destinatarios reales. El VPS no esta en
  una Local Zone de OVH y puede usar SMTP saliente.
- La documentacion anterior (`docs/despliegue.md`) dejaba la topologia abierta y
  describia un proxy TLS en el host que aun no existia. Este ADR registra la
  topologia finalmente desplegada y las condiciones que no deben romperse.

## Decision

Adoptar Cloudflare como frontera publica y separar el frontend estatico del
origen de la API:

```text
Navegador
  -> Cloudflare (TLS, DNS, Access en Grafana)
  -> Worker Static Assets (sipeg-utp.com)
  -> Cloudflare Tunnel (api.sipeg-utp.com, grafana.sipeg-utp.com)
  -> cloudflared en el VPS
  -> api:3000 / grafana:3000 (redes Docker internas)
```

### Frontend

- El frontend se publica en Cloudflare Workers Static Assets con dominio
  personalizado `sipeg-utp.com`.
- El build usa `VITE_API_BASE_URL=https://api.sipeg-utp.com`.
- El repositorio del backend no contiene el Worker ni su configuracion de build.

### Tunel y rutas publicas

- El tunel nombrado `sipeg-produccion` se ejecuta como el servicio `cloudflared`
  de `compose.cloudflare.yaml`. Solo establece conexiones salientes; no requiere
  abrir puertos entrantes en el VPS.
- Rutas publicadas:

| Hostname                | Servicio interno      | Acceso                               |
| ----------------------- | --------------------- | ------------------------------------ |
| `api.sipeg-utp.com`     | `http://api:3000`     | Publico, sin Access                  |
| `grafana.sipeg-utp.com` | `http://grafana:3000` | Cloudflare Access + login de Grafana |

- La API no esta detras de Access: sus clientes usan Bearer tokens, no una sesion
  interactiva de Cloudflare.
- DNS proxied, **Always Use HTTPS** y una regla de **Bypass cache** para ambos
  hostnames. La API y Grafana no deben servirse desde cache.
- Bot Fight Mode puede permanecer activo. Los clientes automatizados de la API,
  incluido el verificador JWT de Node, no deben depender del JWKS publico; ver
  la seccion de identidad.

### Origen y Compose

- El VPS ejecuta la API con tres archivos Compose, en este orden:
  `compose.prod.yaml`, `compose.observability.yaml` y `compose.cloudflare.yaml`,
  con `--env-file .env.prod`.
- Servicios: `migrate`, `seed`, `db`, `api`, `loki`, `docker-socket-proxy`,
  `alloy`, `grafana` y `cloudflared`.
- `migrate` y `seed` son one-shot: aplican migraciones y el catalogo base antes de
  que arranque la API. El seed es idempotente.
- La imagen local de la API se etiqueta con `IMAGE_TAG`, obligatoria y sin default.
  No se reutiliza una etiqueta para codigo distinto.
- La API se publica solo en `127.0.0.1:3000` para diagnostico desde el host.
  Grafana se publica solo en `127.0.0.1:3001`. PostgreSQL no publica puertos.
- El acceso real a la API y a Grafana desde Internet entra por `cloudflared`, no
  por esos puertos de loopback.

### Redes

- `sipeg-utp-prod`: `api`, `db` y `cloudflared`.
- `observability`: `loki`, `alloy`, `docker-socket-proxy`, `grafana` y
  `cloudflared`.
- `cloudflared` es el unico servicio conectado a ambas redes; puede alcanzar
  `api:3000` y `grafana:3000` sin publicar puertos.
- Alloy no monta el socket de Docker directamente. Lo consulta a traves de
  `docker-socket-proxy`, limitado a lectura.
- La separacion evita que los servicios de observabilidad compartan red con la
  base de datos y los servicios de la aplicacion.

### Métricas y exportadores (2026-10-20)

Prometheus, PostgreSQL Exporter, Telegraf, Blackbox Exporter y el listener
privado de la API se comunican por redes internas (`metrics`, `postgres-metrics`
y `docker-api`; Prometheus y Blackbox tambien comparten `observability` para que
Grafana consulte y para los probes, sin publicar puertos). Grafana sigue siendo
el unico servicio del overlay con puerto publicado y solo en `127.0.0.1:3001`
para diagnostico. No se añadió ningun puerto publico ni ruta nueva al tunel:
`/metrics` no es alcanzable por `api:3000` ni por Cloudflare. Ver ADR-0014 y
`observability/README.md`.

### Cookies, CORS y confianza en el proxy

- `sipeg-utp.com`, `api.sipeg-utp.com` y `grafana.sipeg-utp.com` comparten el
  dominio registrable, por lo que API y frontend son same-site.
- `AUTH_REFRESH_COOKIE_SAME_SITE=lax`. `strict` romperia la sesion al llegar desde
  un enlace externo, como el correo de verificacion o el de reset.
- La cookie `sipeg-refresh` es `HttpOnly`, `Secure`, host-only (sin `Domain`) y
  `Path=/api/v1/auth`.
- `CORS_ORIGIN=https://sipeg-utp.com`; `TRUSTED_ORIGINS` queda vacio en este
  despliegue. El access token viaja en el cuerpo y como `Authorization: Bearer`.
- `app.set('trust proxy', 1)` sigue activo. `cloudflared` es el unico salto entre
  Cloudflare y Express; Cloudflare escribe la IP del cliente al final de
  `X-Forwarded-For`. El rate limiting usa `req.ip`.
- Añadir otro proxy delante de la API, o cambiar la cadena de saltos, exige
  revisar `trust proxy` y la agrupacion de buckets. No es un cambio cosmetico.

### Identidad, JWKS y correo

- `AUTH_URL`, `AUTH_ISSUER` y `AUTH_AUDIENCE` son
  `https://api.sipeg-utp.com`.
- `AUTH_JWKS_URL=http://127.0.0.1:3000/api/auth/jwks` es el loopback del
  contenedor de la API. Evita que el verificador JWT dependa del hostname publico,
  donde Bot Fight Mode puede responder con un challenge que Node no puede
  resolver.
- El JWKS publico se comprueba por separado. El campo `authJwksReachable` del
  health mide el endpoint configurado, no la ruta publica.
- El correo transaccional usa Brevo por SMTP: `smtp-relay.brevo.com:587`,
  STARTTLS (`MAIL_SECURE=false`) y remitente
  `SIPEG UTP <no-reply@sipeg-utp.com>`.

### Secretos y operacion

- `.env.prod` es privado, no se versiona, pertenece al operador y tiene permisos
  `600`.
- El token del tunel vive solo en `.env.prod`; no se registra ni se expone en
  respuestas.
- El despliegue se valida con `docker compose config --quiet` antes de aplicar
  cambios.
- Un reinicio del VPS debe recuperar `db`, `api`, observabilidad y `cloudflared`
  por las politicas `restart: unless-stopped`; `migrate` y `seed` no se repiten
  porque la base persiste.

## Consequences

### Positive

- **POS-001**: No hay puertos HTTP/HTTPS entrantes ni certificados TLS que operar
  en el VPS; Cloudflare termina TLS y publica el origen por el tunel.
- **POS-002**: API y frontend comparten sitio, por lo que la sesion con
  `SameSite=Lax` funciona entre pestanas sin cookies de terceros.
- **POS-003**: Grafana queda detras de Access y de su propio login sin abrir un
  puerto publico.
- **POS-004**: La API conserva su superficie publica con CORS explicito, rate
  limiting y JWKS verificable.
- **POS-005**: La separacion de redes y el proxy de socket de solo lectura reducen
  el radio de exposicion del stack de observabilidad.
- **POS-006**: El despliegue es reproducible con los tres Compose, `IMAGE_TAG` y
  migraciones one-shot.

### Negative

- **NEG-001**: La disponibilidad depende de Cloudflare y del tunel; una caida del
  conector deja la API y Grafana inaccesibles aunque el VPS siga sano.
- **NEG-002**: El token del tunel es un secreto operativo de alta sensibilidad y
  debe rotarse con cuidado.
- **NEG-003**: Bot Fight Mode y otras reglas del edge pueden desafiar clientes
  automatizados. El JWKS interno mitiga el caso del verificador, no todos los
  clientes externos.
- **NEG-004**: `trust proxy=1` depende de que `cloudflared` siga siendo el unico
  salto. Un proxy adicional puede agrupar mal los buckets de rate limiting.
- **NEG-005**: Los puertos de loopback de API y Grafana son solo para diagnostico
  desde el VPS; no sustituyen el acceso publico.
- **NEG-006**: La prueba de aislamiento de buckets de rate limiting desde dos redes
  quedo diferida por decision operativa; se documenta como riesgo residual.
- **NEG-007**: El backup y restore de PostgreSQL sigue siendo un procedimiento
  manual que debe probarse.
- **NEG-008**: Los logs de acceso del proxy no llegan a Loki; Alloy recoge los logs
  de los contenedores. La analitica del edge se consulta en Cloudflare.
- **NEG-009**: El frontend se despliega en otro repositorio y su configuracion de
  Worker no forma parte de este backend.

### Neutral

- El origen habla HTTP dentro de la red Docker y del tunel; TLS termina en
  Cloudflare. Esto no cambia la identidad de los tokens ni las firmas EdDSA.
- Los dominios y el tunel son infraestructura, no contrato de API. Cambiarlos
  exige actualizar variables, DNS y este ADR.

## Alternatives Considered

### nginx o Caddy en el VPS con Let's Encrypt

- **ALT-001**: **Description**: Publicar 80/443 en el VPS, terminar TLS en el host
  y renovar certificados con ACME.
- **ALT-002**: **Rejection Reason**: Abre puertos entrantes, expone la IP del
  origen, añade gestion de certificados y mantiene un unico punto de falla en el
  host. El tunel evita esa superficie.

### DNS proxied de Cloudflare hacia puertos abiertos del origen

- **ALT-003**: **Description**: Mantener 80/443 abiertos y apuntar los registros
  proxied al VPS.
- **ALT-004**: **Rejection Reason**: El origen queda alcanzable si se conoce la IP
  y se depende de reglas de firewall para limitar el acceso. El tunel no necesita
  puertos entrantes.

### Plataforma gestionada (Railway, Render, Fly)

- **ALT-005**: **Description**: Mover API y base de datos a un proveedor PaaS.
- **ALT-006**: **Rejection Reason**: Menor control sobre residencia de datos,
  coste variable, dependencia del proveedor y migracion del stack de observabilidad
  y correo.

### Cloudflare Access tambien en la API

- **ALT-007**: **Description**: Proteger `api.sipeg-utp.com` con Access.
- **ALT-008**: **Rejection Reason**: Access esta pensado para sesiones
  interactivas; los clientes con Bearer, el health y los flujos de correo no
  pueden completar el challenge. La API se protege con autenticacion propia,
  CORS y rate limiting.

### Cloudflare Pages en lugar de Workers Static Assets

- **ALT-009**: **Description**: Publicar el build estatico en Pages.
- **ALT-010**: **Rejection Reason**: Es una alternativa valida, pero el proyecto
  frontend ya usa Workers Static Assets y `wrangler deploy`. Cambiarlo no aporta
  una ventaja para esta decision.

### Red privada tipo Tailscale sin exposicion publica

- **ALT-011**: **Description**: Acceder a la API solo por VPN.
- **ALT-012**: **Rejection Reason**: No ofrece el dominio publico que necesita el
  frontend ni el acceso de usuarios a la API.

## Implementation Notes

- **IMP-001**: El comando de despliegue es:
  ```bash
  docker compose \
    -f compose.prod.yaml \
    -f compose.observability.yaml \
    -f compose.cloudflare.yaml \
    --env-file .env.prod \
    up -d --build
  ```
- **IMP-002**: Antes de desplegar, validar con el mismo comando y `config --quiet`.
  No imprimir el contenido de `.env.prod`.
- **IMP-003**: En Cloudflare, mantener las rutas del tunel, el bypass de cache y
  Access solo en Grafana. Confirmar el team name `sipeg` y la politica Allow.
- **IMP-004**: Verificar `https://api.sipeg-utp.com/api/v1/health` con
  `authJwksReachable: true`, el JWKS publico con clave EdDSA, el preflight CORS y
  una peticion protegida desde el navegador.
- **IMP-005**: Verificar los atributos de `sipeg-refresh` en el navegador:
  `HttpOnly`, `Secure`, `SameSite=Lax`, host-only y `Path=/api/v1/auth`.
- **IMP-006**: Tras un reinicio del VPS, comprobar `ps -a`, el estado Healthy del
  tunel y el health publico. `migrate` y `seed` deben permanecer terminados; no
  se reejecutan por el reinicio.
- **IMP-007**: La prueba de aislamiento de buckets entre dos redes queda diferida.
  No se ejecuto para no bloquear la IP del operador. Debe repetirse antes de
  ajustar umbrales de rate limiting con trafico real.
- **IMP-008**: Definir y probar un backup/restore de PostgreSQL antes de tratarlo
  como procedimiento operativo.
- **IMP-009**: Cualquier cambio de topologia, dominios, saltos de proxy o
  proteccion de Grafana debe actualizar este ADR y `docs/despliegue.md`.

## References

- **REF-001**: `docs/adr/adr-0007-structured-logging-and-observability.md`.
- **REF-002**: `docs/adr/adr-0009-refresh-token-cookie-httponly.md`.
- **REF-003**: `docs/despliegue.md`.
- **REF-004**: `docs/superpowers/plans/despliegue-aplicacion.md`.
- **REF-005**: [Cloudflare Tunnel: routing](https://developers.cloudflare.com/tunnel/concepts/routing/).
- **REF-006**: [Cloudflare Tunnel: conectividad y puertos salientes](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).
- **REF-007**: [Cloudflare Access: aplicacion autohospedada](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
- **REF-008**: [Express detras de proxies](https://expressjs.com/en/guide/behind-proxies).
- **REF-009**: [OVH: envio de correo y restricciones SMTP](https://docs.ovhcloud.com/en/guides/bare-metal-cloud/dedicated-servers/mail-sending-optimization.md).
