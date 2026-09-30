# Modelo de despliegue: decision pendiente y decisiones que bloquea

## Estado

**Abierta.** No se ha elegido topologia de despliegue.

No es una decision cosmetica: `compose.prod.yaml` ya exige
`AUTH_REFRESH_COOKIE_SAME_SITE` con sintaxis `:?`, asi que el stack de produccion
no arranca sin ella. Es decir, la variable que hoy falta es justamente la que
depende de esta eleccion. Ademas, `ADR-0007` deja constancia de que la produccion
sirve la API en HTTP plano porque el proxy TLS que debe terminarla no existe.

## Que asume el repositorio hoy

Todo lo siguiente es un hecho verificable del repositorio, no una propuesta:

- `compose.prod.yaml` define un unico stack con `migrate`, `seed`, `api` y `db`
  sobre la red `sipeg-utp-prod`, con volumen `postgres_data`.
- `api` publica **solo en `127.0.0.1:${PORT:-3000}`**. El puerto no esta expuesto
  a la red. Eso ya asume un proxy TLS en el mismo host: es el unico cliente
  posible del puerto.
- La regla de no publicar nada en `0.0.0.0` y las condiciones que debe cumplir el
  proxy estan fijadas en `ADR-0007`, seccion "Puertos Publicados". En particular,
  `app.set('trust proxy', 1)` esta activo y el rate limiting construye su llave
  con `req.ip`, lo que exige **exactamente un salto de proxy**.
- `CORS_ORIGIN` admite un unico origen y `TRUSTED_ORIGINS` anade CSV. Deben
  contener el **origen** del frontend, no su URL base ni su ruta.
- `DOCS_ENABLED` queda deshabilitado por defecto en produccion.
- El frontend se construye como estatico en `dist/` y `VITE_API_BASE_URL` es
  obligatoria en produccion: `src/app/adapters/http/apiClient.ts` lanza si falta.
- Alloy recoge logs de los contenedores Docker, no del proxy. El proxy no deja
  rastro en Loki mientras no se le anada.

## Decision a tomar: modelo de despliegue

### Opciones

| Opcion | Descripcion | Coste y operativa | Datos |
| --- | --- | --- | --- |
| **A** | Un host con proxy inverso (nginx/Caddy) y subdominios del mismo dominio registrable | Menor coste; un solo lugar que operar, respaldar y asegurar | Todo en la institucion |
| **B** | Dos hosts separados: API y frontend en equipos distintos | Dos superficies que asegurar, dos pipelines de despliegue | Repartidos |
| **C** | Plataforma gestionada (Railway, Render, Fly) con dominios distintos | Menor carga operativa; coste variable y proveedor atado | Salen de la institucion |
| **D** | Opcion A mas CDN o WAF delante del proxy | Mas superficie que asumir, y rompe el requisito de un solo salto | Todo en la institucion |

### Criterios para decidir

1. **Dominio delegable**: si la institucion no puede delegar subdominios, la
   opcion A no es viable y todo se desplaza a cross-site.
2. **Residencia de los datos**: las historias personales, el detalle de asistencia y
   los CV de ponentes condicionan si pueden salir de la institucion. Si la respuesta
   es no, quedan B o D.
3. **Capacidad operativa**: quien aplica parches, rota secretos y hace restore.
4. **Disponibilidad**: el proxy TLS se convierte en punto unico de falla en A, D y
   C.

### Recomendacion inicial: opcion A

Se recomienda **A** (un host, proxy inverso, subdominios del mismo dominio
registrable) por estas razones:

- El bind a loopback de `compose.prod.yaml` ya esta escrito para ese escenario.
- A es la unica opcion que deja el despliegue dentro de la institucion sin
  renunciar a un proxy TLS propio.
- Mantener API y frontend en el **mismo dominio registrable** es lo que permite
  `SameSite` sin `None` y evita depender de que el navegador acepte cookies de
  terceros. Los navegadores llevan tiempo restringiendo las cookies de terceros,
  y una sesion basada en cookie cross-site es justo lo que esas restricciones
  persiguen. Adoptar cross-site es decidir con handicap antes de tener que
  hacerlo.

La opcion D queda descartada mientras `trust proxy = 1` siga fijo, porque anadir
un salto cambia en silencio la agrupacion de los buckets de rate limit
(comportamiento de seguridad, segun `ADR-0007`).

### El criterio que decide `lax` o `none`

`SameSite` no depende del host ni del puerto, sino del **sitio**, es decir del
dominio registrable (eTLD+1) y del esquema:

| Caso | Ejemplo | Sitio | Valor |
| --- | --- | --- | --- |
| Mismo dominio registrable | `api.utp.ac.pa` + `app.utp.ac.pa` | mismo | `lax` |
| Dominios distintos | `api.sipegutp.com` + `utp.ac.pa` | distinto | `none` |

Con `none` la cookie exige `Secure`, y por tanto **HTTPS real en ambos extremos**.
`AUTH_REFRESH_COOKIE_SAME_SITE=none` se rechaza fuera de produccion precisamente
porque alli no hay HTTPS.

### `lax` y no `strict`

Ambos serian validos en el escenario same-site. Se recomienda `lax` porque
`strict` descarta la cookie cuando el usuario llega por navegacion desde un
enlace externo, tipicamente el correo de verificacion o el de reset de contrasena.
La sesion sobrevive a esa navegacion, pero la cookie no, y el refresh siguiente
falla con 401. `lax` no cuesta nada aqui: la cookie solo se usa en peticiones
same-site, que es exactamente lo que ambos valores permiten.

## Decisiones derivadas

Cada fila queda bloqueada hasta que se elija la opcion de despliegue.

| # | Decision | Depende de | Consecuencia de equivocarse |
| --- | --- | --- | --- |
| 1 | Dominio registrable de API y frontend | Opcion | Si difieren, `none` y HTTPS obligatorio |
| 2 | `AUTH_REFRESH_COOKIE_SAME_SITE` | #1 | Sin esta variable el stack no arranca |
| 3 | `Secure` de cookies | Entorno | Ya forzado a `true` en produccion |
| 4 | Numero de saltos de proxy delante de la API | Opcion | `>1` rompe `req.ip` y los limitadores por IP |
| 5 | `CORS_ORIGIN` y `TRUSTED_ORIGINS` | Origen real del frontend | Origen equivocado bloquea login y verificacion |
| 6 | `AUTH_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE` | URL publica de la API | Issuer o audience incorrectos invalidan el JWT |
| 7 | `VITE_API_BASE_URL` | URL publica de la API | El frontend lanza al arrancar |
| 8 | Emision y renovacion de certificados TLS | Proxy | HTTPS sin renovar rompe la sesion |
| 9 | Logs de acceso del proxy | Formato compatible con Loki | Se pierde el rastro de 4xx/5xx en frontera |
| 10 | Backup y restore de Postgres | Topologia | Sin restore probado, un fallo es perdida de datos |
| 11 | Ejecucion de migraciones por despliegue | Pipeline | `migrate` y `seed` son servicios efimeros en cada despliegue |
| 12 | Acceso operativo a Grafana | Topologia | Hoy solo por loopback; necesita `root_url` y proxy |

## Cuando se tome la decision

1. Registrar el modelo elegido como ADR nuevo, siguiendo la plantilla de
   `docs/adr/`, y actualizar el estado de este documento.
2. Fijar `AUTH_REFRESH_COOKIE_SAME_SITE` con el valor de la tabla anterior.
3. Fijar `CORS_ORIGIN`, `AUTH_URL` y `VITE_API_BASE_URL` con los valores reales.
4. Anadir el proxy TLS al repositorio, cumpliendo las condiciones de `ADR-0007`.
5. Marcar aqui las decisiones derivadas que quedan resueltas.
6. Ejecutar el recorrido E2E contra el entorno real: es la primera prueba de que la
   sesion sobrevive a traves de pestanas con la topologia definitiva.

## Referencias

- `docs/adr/adr-0007-structured-logging-and-observability.md`, seccion "Puertos
  Publicados" y "Brecha: no hay terminacion TLS".
- `docs/adr/adr-0009-refresh-token-cookie-httponly.md`, seccion "Decision de
  topologia".
- `compose.prod.yaml` y `.env.example`.