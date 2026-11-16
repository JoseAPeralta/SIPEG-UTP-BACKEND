# Alertas de Grafana más específicas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (habilidad instalada: `executing-plans`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ejecutar en línea; no delegar ni desplegar sin autorización del usuario.

**Goal:** Los correos de las 21 alertas existentes deben identificar las series afectadas, mostrar el valor y su interpretación y orientar la investigación, sin alterar cuándo se dispara o resuelve una alerta.

**Architecture:** Mantener las condiciones clásicas y enriquecer `annotations.description` con `$values`, que conserva las etiquetas de las series que incumplen la condición aunque `$labels` no las conserve. Reutilizar los correos, enlaces a paneles y agrupación actuales; comprobar que todo el contrato de detección permanece idéntico mediante snapshots generados antes de editar las reglas.

**Tech Stack:** Grafana 13.2.2 provisionado por YAML; Prometheus 3.15.0; Loki 3.7.8; Vitest 4.1.11; paquete `yaml` 2.9.1; Node.js/pnpm del repositorio. Sin dependencias nuevas.

---

## 1. Alcance, evidencia y límites

El incidente del 14 de noviembre de 2026 dejó correos con `B0=1`, sin indicar el probe. Los eventos de Cloudflare demostraron desafíos de Bot Fight Mode a Blackbox. Después de desactivarlo, el usuario comprobó siete códigos HTTP 200 y siete `probe_success=1`. Esta es evidencia del estado de esas muestras, no una explicación concluyente de cada episodio intermedio.

El repositorio tiene 15 reglas en `metrics.yaml` y 6 en `rules.yaml`. Todas tienen una única condición clásica B, alimentada por A. No hace falta migrar a alertas multidimensionales para conseguir el detalle solicitado.

### Incluido

- Identificar `check`, `route`, `instance`, `job`, `module`, `service`, `project`, `collector`, `mountpoint` y `fstype` cuando existan, usando una lista permitida.
- Mostrar el valor reducido de la serie junto con unidad, umbral e interpretación.
- Enumerar todas las series afectadas; no asumir que `B0` existe ni que solo falla una.
- Explicar qué revisar para cada familia de alertas, con especial atención a disponibilidad y JWKS.
- Describir correctamente evaluaciones sin detalle, errores de consulta y recuperaciones.
- Probar el contrato estático y verificar el renderizado real con la imagen fijada de Grafana.

### Excluido

- No cambiar consultas A, expresiones B, títulos, UIDs, labels, severidades, intervalos, `for`, `noDataState`, `execErrState`, enlaces existentes ni umbrales.
- No cambiar `contact-points.yaml`, `notification-policies.yaml`, destinatarios, SMTP, agrupación o frecuencias de correo.
- No agregar reglas por probe ni convertir el incidente en siete notificaciones independientes.
- No cambiar Cloudflare, Tunnel, `AUTH_JWKS_URL`, la API, endpoints, OpenAPI, imágenes ni variables de entorno.
- No inferir HTTP 403 a partir de un valor de condición igual a 1. Esta fase no incorpora códigos HTTP al correo: `probe_success` no los contiene.
- No prometer detectar la ausencia individual de cada probe: la consulta actual solo detecta ausencia global. Mejorar esa cobertura sería otro cambio de detección.
- No afirmar automáticamente «Bot Fight Mode», «DNS» o «TLS» como causa. El correo identifica la señal; la causa se confirma con evidencia adicional.

### Criterios de aceptación

1. Un probe público fallido muestra su `check`, `route=public`, URL, módulo y job, no solo `B0=1`.
2. Tres probes fallidos aparecen como tres entradas en la misma instancia/correo agrupado.
3. Un servicio Docker fallido muestra `service` y `project` disponibles; un collector PostgreSQL fallido muestra `collector`.
4. CPU, memoria, disco, TLS y API muestran valor y unidad correctos. Una consulta global se identifica como global, sin inventar una ruta o instancia.
5. Los seis avisos de `rules.yaml` también muestran los valores, con conteo/porcentaje y ventana correctos.
6. No se imprimen objetos completos de etiquetas, tokens, emails, IPs de usuarios, cuerpos de solicitudes ni contenido de logs.
7. No aparecen plantillas literales ni errores de expansión en la evaluación real de Grafana.
8. La proyección de los dos archivos, excluyendo únicamente `annotations`, coincide con el baseline previo.
9. Los correos de recuperación mantienen el estado Resolved del correo estándar; la descripción no finge conservar la lista histórica del primer fallo.

## 2. Archivos y responsabilidades

| Archivo                                                       | Acción                                        | Responsabilidad                                    |
| ------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `observability/grafana/provisioning/alerting/metrics.yaml`    | Modificar solo anotaciones                    | Detalle de 15 alertas de métricas                  |
| `observability/grafana/provisioning/alerting/rules.yaml`      | Modificar anotaciones y comentarios obsoletos | Detalle de 5 alertas Loki y disco warning          |
| `src/observability/alert-messages.test.ts`                    | Crear                                         | Contrato de mensajes y protección de configuración |
| `src/observability/__snapshots__/alert-messages.test.ts.snap` | Crear desde estado previo                     | Baseline de detección y notificaciones             |
| `observability/README.md`                                     | Modificar                                     | Lectura de mensajes, diagnóstico y validación      |
| `CONTEXT.md`                                                  | Modificar un punto de observabilidad          | Resumen de capacidad y vínculo al README           |

No crear un módulo de producción ni un generador: los mensajes siguen siendo responsabilidad del YAML. No hace falta modificar los tipos del verificador, porque las pruebas nuevas pueden declarar sus tipos locales. No hace falta un ADR nuevo: no cambia la arquitectura.

Los archivos ajenos ya presentes en `git status` —incluido `AGENTS.md` modificado— son trabajo del usuario y no se deben sobrescribir. Si al ejecutar la tarea se considera necesario documentar esta mejora en `AGENTS.md`, proponer una inserción mínima y revisar su diff; no reescribir el archivo.

## 3. Diseño del mensaje

### 3.1 Bloque común literal

Añadir este bloque al final de cada `annotations.description`, después del encabezado específico de la tabla siguiente. Usar bloque YAML `|` para conservar los saltos. Es un bloque de anotaciones de regla, no de plantilla de notificaciones; aquí `$values` se escribe con un solo `$` porque las anotaciones están excluidas de la interpolación de variables de entorno del provisioning.

```gotemplate
{{ $found := false -}}
{{ range $key, $value := $values -}}
{{ if match "^B[0-9]+$" $key -}}
{{ $found = true -}}
- valor={{ printf "%.2f" $value.Value }}{{ with $value.Labels.check }}; check={{ . }}{{ end }}{{ with $value.Labels.route }}; route={{ . }}{{ end }}{{ with $value.Labels.instance }}; instance={{ . }}{{ end }}{{ with $value.Labels.job }}; job={{ . }}{{ end }}{{ with $value.Labels.module }}; module={{ . }}{{ end }}{{ with $value.Labels.service }}; service={{ . }}{{ end }}{{ with $value.Labels.project }}; project={{ . }}{{ end }}{{ with $value.Labels.collector }}; collector={{ . }}{{ end }}{{ with $value.Labels.mountpoint }}; mountpoint={{ . }}{{ end }}{{ with $value.Labels.fstype }}; fstype={{ . }}{{ end }}{{ if not $value.Labels }}; alcance=global, sin etiquetas de recurso{{ end }}
{{ end -}}
{{ end -}}
{{ if not $found -}}
Sin detalle de series para esta evaluación. Consultar el estado de la regla y los errores del datasource; este texto no confirma por sí solo ni salud ni recuperación.
{{ end }}
```

Las claves `B0`, `B1`, etc. solo seleccionan los valores; no se imprimen como identidad del recurso. Grafana documenta que estas entradas corresponden a las series que incumplen las condiciones clásicas. No implementar un segundo evaluador de umbrales en la plantilla ni usar `$values.A` como si identificara todas las series.

Las consultas agregadas han eliminado algunas etiquetas antes de llegar a Grafana. En ese caso mostrar alcance global. No se puede recuperar la ruta original sin cambiar la consulta, fuera de alcance.

### 3.2 Encabezados exactos antes del bloque común

Conservar las instrucciones operativas útiles de las descripciones existentes y añadir exactamente el encabezado de esta tabla. No cambiar el resto del contrato de la regla.

| UID                                     | Encabezado                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sipeg-target-down`                     | `Detalle: indicador de recolección fallida o job ausente; fallo=1; esperado=0; condición >0 durante 2m.`                                                                   |
| `sipeg-host-network-stale`              | `Detalle: antigüedad del recolector en segundos; condición >180 s durante 2m.`                                                                                             |
| `sipeg-postgres-exporter-errors`        | `Detalle: indicador de error del exporter o fallo del collector; condición >0 durante 5m. Si existe collector, identifica el recolector afectado.`                         |
| `sipeg-host-cpu-high`                   | `Detalle: CPU utilizada en %; condición >90 % durante 15m; cálculo sobre ventana de 5m.`                                                                                   |
| `sipeg-host-memory-low`                 | `Detalle: memoria disponible en %; condición <10 % durante 10m.`                                                                                                           |
| `sipeg-host-inodes-low`                 | `Detalle: inodos libres en %; condición <10 % durante 15m.`                                                                                                                |
| `sipeg-disk-critical`                   | `Detalle: disco utilizado en %; condición >90 % durante 10m.`                                                                                                              |
| `sipeg-postgres-down`                   | `Detalle: indicador 1-pg_up; fallo=1; esperado=0; condición >0 durante 2m. Una serie ausente no equivale a pg_up=0.`                                                       |
| `sipeg-postgres-connections-high`       | `Detalle: conexiones usadas en % de max_connections; condición >85 % durante 5m; alcance global de la consulta.`                                                           |
| `sipeg-docker-service-not-running`      | `Detalle: cantidad de contenedores no running por proyecto y servicio; condición >0 durante 2m; excluye migrate y seed.`                                                   |
| `sipeg-docker-critical-service-missing` | `Detalle: indicador de serie de servicio crítico ausente; fallo=1; esperado=0; condición >0 durante 2m. Ausencia de métricas no demuestra por sí sola caída del servicio.` |
| `sipeg-probe-failing`                   | `Detalle: indicador de probe fallido o ausencia global; fallo=1; esperado=0; condición >0 durante 2m. El valor no es un código HTTP.`                                      |
| `sipeg-tls-expiring`                    | `Detalle: días restantes del certificado TLS público; condición <7 días durante 1h. Un valor negativo indica expiración.`                                                  |
| `sipeg-api-latency-high`                | `Detalle: latencia p95 en segundos; condición >1 s durante 10m; requiere más de 20 solicitudes completadas en 5m; alcance global de la consulta.`                          |
| `sipeg-http-5xx-ratio`                  | `Detalle: respuestas 5xx en %; condición >5 % durante 5m; requiere más de 20 solicitudes completadas en 5m; alcance global de la consulta.`                                |
| `sipeg-fatal`                           | `Detalle: eventos fatales en 5m; condición >0; sin espera adicional; alcance global de la consulta.`                                                                       |
| `sipeg-unexpected-errors`               | `Detalle: errores inesperados en 5m; condición >5; sin espera adicional; alcance global de la consulta.`                                                                   |
| `sipeg-5xx`                             | `Detalle: respuestas 5xx en 5m; condición >10; sin espera adicional; alcance global de la consulta.`                                                                       |
| `sipeg-auth-failures`                   | `Detalle: intentos de login fallidos en 5m; condición >20; sin espera adicional; alcance global de la consulta.`                                                           |
| `sipeg-rate-limits`                     | `Detalle: rate limits en 5m; condición >30 durante 2m; alcance global de la consulta.`                                                                                     |
| `sipeg-disk-full`                       | `Detalle: disco utilizado en %; condición >80 % durante 15m.`                                                                                                              |

### 3.3 Texto operativo de disponibilidad

Reemplazar el texto operativo actual de `sipeg-probe-failing` por este, antes de su encabezado y bloque dinámico:

```text
Un probe funcional incumple el estado HTTP, el contenido esperado o TLS, o desaparecieron todas las series de probes. Comparar el mismo check entre route=internal y route=public: un fallo solo público orienta al recorrido público, pero no identifica por sí solo la causa. Un HTTP 403 exige revisar cf-mitigated y Security Events; no atribuirlo automáticamente a bots. Un código HTTP 0 puede acompañar errores de conexión, DNS, TLS o timeout; consultar el diagnóstico de Blackbox. Un HTTP 200 también puede fallar por contenido o por authJwksReachable=false. Revisar probe_success, probe_http_status_code, up y el panel Availability. El check api-jwks consulta health y valida authJwksReachable; el check jwks consulta /api/auth/jwks y valida keys. No aceptar 403 como sano ni silenciar la regla para ocultar el fallo. Todas estas comprobaciones salen del mismo VPS: no equivalen a monitoreo externo independiente.
```

No usar este texto para otra regla: los valores de TLS, CPU o Postgres tienen otra interpretación.

### 3.4 Ejemplo esperado del cuerpo de un correo de disponibilidad

```text
Probe de disponibilidad fallido
Detalle: indicador de probe fallido o ausencia global; fallo=1; esperado=0; condición >0 durante 2m. El valor no es un código HTTP.
- valor=1.00; check=api-health; route=public; instance=https://api.sipeg-utp.com/api/v1/health; job=blackbox-public; module=https_health_public
- valor=1.00; check=jwks; route=public; instance=https://api.sipeg-utp.com/api/auth/jwks; job=blackbox-public; module=https_jwks_public
```

La lista usa el estado disponible en la evaluación. La instancia clásica sigue siendo global: si un probe se recupera y otro permanece mal, no habrá necesariamente un correo de recuperación individual del primero. Una anotación tampoco mantiene un historial de los primeros afectados.

## 4. Tareas de implementación

### Tarea 1: proteger el comportamiento previo antes de editar YAML

**Archivos:** crear `src/observability/alert-messages.test.ts` y su snapshot.

- [x] **Paso 1:** Confirmar el estado del árbol con `git status --short`. Releer ambos YAML y los tests de provisioning. No actualizar dependencias ni regenerar otros archivos.
- [x] **Paso 2:** Crear la siguiente base de prueba. Este guard debe ejecutarse ANTES de cualquier cambio en las reglas; no generar el baseline a partir de la implementación nueva.

```ts
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface MessageRule {
  uid: string;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

interface MessageDocument {
  groups?: Array<{
    rules?: MessageRule[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

const load = async (name: string): Promise<MessageDocument> =>
  parse(
    await readFile(
      new URL(`../../observability/grafana/provisioning/alerting/${name}`, import.meta.url),
      'utf8',
    ),
  ) as MessageDocument;

const withoutAnnotations = (document: MessageDocument): MessageDocument => ({
  ...document,
  ...(document.groups === undefined
    ? {}
    : {
        groups: document.groups.map((group) => ({
          ...group,
          rules: (group.rules ?? []).map((rule) => {
            const copy = { ...rule };
            delete copy.annotations;
            return copy;
          }),
        })),
      }),
});

describe.each(['rules.yaml', 'metrics.yaml'])('%s: contrato previo', (name) => {
  it('conserva toda la configuración excepto anotaciones', async () => {
    expect(withoutAnnotations(await load(name))).toMatchSnapshot();
  });
});

describe.each(['contact-points.yaml', 'notification-policies.yaml'])(
  '%s: notificaciones',
  (name) => {
    it('conserva contacto, recuperación, agrupación y frecuencias', async () => {
      expect(await load(name)).toMatchSnapshot();
    });
  },
);
```

- [x] **Paso 3:** Ejecutar `pnpm exec vitest run src/observability/alert-messages.test.ts --update`. Esperado: cuatro snapshots del estado original, sin secretos reales; `addresses` sigue siendo `$ALERT_EMAIL_TO`. Revisar el contenido antes de continuar.
- [x] **Paso 4:** Ejecutar el mismo comando SIN `--update`. Esperado: cuatro pruebas pasan. A partir de aquí, no actualizar estos snapshots para acomodar cambios de detección.

### Tarea 2: escribir primero el contrato que falla

**Archivo:** ampliar `src/observability/alert-messages.test.ts`.

- [x] **Paso 1:** Añadir la siguiente prueba al archivo. La tabla de encabezados completa de la sección 3.2 se verifica en el paso de revisión; esta prueba fija unidades representativas y la estructura dinámica de las 21 reglas.

```ts
const IDENTIFIER_KEYS = [
  'check',
  'route',
  'instance',
  'job',
  'module',
  'service',
  'project',
  'collector',
  'mountpoint',
  'fstype',
] as const;

it('las 21 reglas muestran valor y etiquetas permitidas sin cambiar su identidad', async () => {
  const documents = await Promise.all(['rules.yaml', 'metrics.yaml'].map(load));
  const rules = documents.flatMap((document) =>
    (document.groups ?? []).flatMap((group) => group.rules ?? []),
  );
  expect(rules).toHaveLength(21);
  expect(new Set(rules.map((rule) => rule.uid)).size).toBe(21);

  for (const rule of rules) {
    const description = rule.annotations?.['description'] ?? '';
    expect(description, rule.uid).toContain('Detalle:');
    expect(description, rule.uid).toContain('range $key, $value := $values');
    expect(description, rule.uid).toContain('match "^B[0-9]+$" $key');
    expect(description, rule.uid).toContain('printf "%.2f" $value.Value');
    expect(description, rule.uid).toContain('if not $found');
    expect(description, rule.uid).toContain('Sin detalle de series para esta evaluación.');
    expect(description, rule.uid).toContain('alcance=global');
    for (const key of IDENTIFIER_KEYS) {
      expect(description, `${rule.uid}/${key}`).toContain(`$value.Labels.${key}`);
    }
    expect(description, rule.uid).not.toMatch(/\$labels\b/);
    expect(description, rule.uid).not.toMatch(/\{\{\s*\$value\.Labels\s*\}\}/);
    expect(description, rule.uid).not.toContain('$$values');
    expect(description, rule.uid).not.toMatch(
      /\$value\.Labels\.(email|ip|token|userId|requestId)\b/,
    );
  }

  const message = (uid: string): string => {
    const rule = rules.find((candidate) => candidate.uid === uid);
    expect(rule, uid).toBeDefined();
    return rule?.annotations?.['description'] ?? '';
  };

  expect(message('sipeg-probe-failing')).toContain('El valor no es un código HTTP.');
  expect(message('sipeg-probe-failing')).toContain('authJwksReachable');
  expect(message('sipeg-probe-failing')).toContain('cf-mitigated');
  expect(message('sipeg-probe-failing')).toContain('mismo VPS');
  expect(message('sipeg-host-memory-low')).toContain('condición <10 % durante 10m');
  expect(message('sipeg-tls-expiring')).toContain('condición <7 días durante 1h');
  expect(message('sipeg-api-latency-high')).toContain('latencia p95 en segundos');
  expect(message('sipeg-http-5xx-ratio')).toContain('más de 20 solicitudes');
  expect(message('sipeg-5xx')).toContain('condición >10');
  expect(message('sipeg-disk-full')).toContain('condición >80 % durante 15m');
});
```

- [x] **Paso 2:** Ejecutar `pnpm exec vitest run src/observability/alert-messages.test.ts`. Esperado: falla porque las descripciones actuales no contienen `Detalle:`/el bloque de `$values`, mientras los cuatro guards del baseline permanecen verdes. Si falla por otra razón, resolver el test antes de editar implementación.

Estas pruebas son estáticas: NO ejecutan Go templates ni demuestran el renderizado. La tarea 4 es obligatoria para comprobar ese comportamiento.

### Tarea 3: enriquecer las anotaciones de las 21 reglas

**Archivos:** `metrics.yaml`, `rules.yaml`.

- [x] **Paso 1:** Para cada UID de la tabla 3.2, editar únicamente `annotations.description`: conservar diagnóstico útil, añadir su encabezado exacto y el bloque literal 3.1. Emplear `description: |` y la indentación actual de la regla. No interpolar valores observados en producción ni agregar plantillas externas no disponibles para las anotaciones.
- [x] **Paso 2:** En `sipeg-probe-failing`, usar además el texto operativo completo de la sección 3.3. Conservar `summary`, UID y dashboard/panel actuales.
- [x] **Paso 3:** Corregir SOLO estos textos obsoletos de `rules.yaml`: el comentario inicial que dice que no existe contact point y los párrafos de `sipeg-rate-limits` que afirman que no existe proxy TLS/configuración fiable de `X-Forwarded-For`. El despliegue actual ya usa Tunnel y `trust proxy=1`; no recalibrar por ello el umbral. Para esos fragmentos usar estos reemplazos:

```yaml
# Las alertas notifican por el contact point sipeg-email, provisionado en
# contact-points.yaml, con la política de notification-policies.yaml.
```

```text
Los rate limits dependen del limitador y de su bucket; usuarios legítimos pueden compartir una IP. El despliegue actual usa Cloudflare Tunnel y trust proxy=1. Revisar el panel de rate limits por limitador y verificar la cadena de IP antes de atribuir un pico a un ataque o recalibrar umbrales. Esta regla cuenta eventos, no usuarios únicos ni direcciones IP únicas.
```

No borrar las instrucciones de panel útiles ni afirmar que el conteo permite identificar al atacante. Actualizar también el comentario local previo a `for: 2m` que repite esa premisa antigua:

```yaml
# Umbral >30 eventos en 5m, sostenido 2m; se conserva sin recalibración.
# Revisar el limitador y la cadena de IP antes de atribuir la causa.
```

- [x] **Paso 4:** Corregir la descripción de `sipeg-disk-full`, que habla incorrectamente de la razón de bytes disponibles «por encima del 80%». Texto operativo exacto antes del encabezado y bloque:

```text
El porcentaje de disco utilizado, calculado como 100 * (1 - bytes disponibles / bytes totales), supera el 80% en el filesystem raíz durante 15 minutos. Revisar volúmenes Docker, backups locales y retención de Loki. Es una señal distinta del agotamiento de inodos.
```

- [x] **Paso 5:** Ejecutar `pnpm exec vitest run src/observability/alert-messages.test.ts src/observability/provisioning.test.ts`. Esperado: todo pasa; ningún snapshot requiere actualización. Revisar `git diff -- observability/grafana/provisioning/alerting` para confirmar cambios solo de anotaciones/comentarios.

### Tarea 4: validar expansión real y recuperación en Grafana local

**Entorno:** instancia local/de pruebas con Grafana 13.2.2 y Prometheus. No producir fallos ni alertas de prueba en producción. No apagar API, base, túnel ni exporters para probar mensajes.

- [x] **Paso 1:** Usar el stack local existente. Si no existe, pedir aprobación para iniciarlo con el Compose de desarrollo; no asumir que Docker disponible equivale a permiso para arrancar servicios. En local, mantener `GF_SMTP_ENABLED=false`. Con servicios ya disponibles, aplicar el YAML únicamente a Grafana:

```bash
GF_SMTP_ENABLED=false docker compose \
  -f compose.dev.yaml -f compose.observability.yaml \
  up -d --no-deps --force-recreate grafana
```

- [x] **Paso 2:** Crear en la UI local una regla temporal, no provisionada, dentro de una carpeta `SIPEG UTP - pruebas`. Usar una consulta instantánea Prometheus A y una condición clásica B `last(A) > 0`; para acelerar solo esta prueba, `for=0s`. Copiar la descripción de disponibilidad implementada. No modificar las reglas provisionadas para poder editarlas. Adaptación ejecutada por API local, documentada en la sección 7.
- [x] **Paso 3:** Ejecutar estos casos sintéticos, uno cada vez. Inspeccionar anotaciones de la instancia real tras su evaluación; el botón de prueba del contact point por sí solo NO evalúa anotaciones de reglas. Se usaron reglas temporales independientes en paralelo para aislar los casos, sin alterar las reglas existentes.

**Un probe público:**

```promql
label_replace(label_replace(label_replace(label_replace(label_replace(vector(1), "check", "api-health", "", ""), "route", "public", "", ""), "instance", "https://api.sipeg-utp.com/api/v1/health", "", ""), "job", "blackbox-public", "", ""), "module", "https_health_public", "", "")
```

**Tres probes simultáneos:**

```promql
label_replace(label_replace(label_replace(label_replace(label_replace(vector(1), "check", "api-health", "", ""), "route", "public", "", ""), "instance", "https://api.sipeg-utp.com/api/v1/health", "", ""), "job", "blackbox-public", "", ""), "module", "https_health_public", "", "")
or
label_replace(label_replace(label_replace(label_replace(label_replace(vector(1), "check", "api-jwks", "", ""), "route", "public", "", ""), "instance", "https://api.sipeg-utp.com/api/v1/health", "", ""), "job", "blackbox-public", "", ""), "module", "https_health_public_jwks", "", "")
or
label_replace(label_replace(label_replace(label_replace(label_replace(vector(1), "check", "jwks", "", ""), "route", "public", "", ""), "instance", "https://api.sipeg-utp.com/api/auth/jwks", "", ""), "job", "blackbox-public", "", ""), "module", "https_jwks_public", "", "")
```

**Matriz restante:** cada expresión sustituye A en la regla temporal; copiar la descripción correspondiente, ajustar el evaluador de la regla temporal cuando se indica y restaurarlo antes del caso siguiente.

| Caso              | Expresión A                                                                                                | Condición temporal                         | Resultado esperado                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Servicio Docker   | `label_replace(label_replace(vector(2), "service", "api", "", ""), "project", "sipeg-prueba", "", "")`     | `>0`                                       | `valor=2.00`, `service=api`, `project=sipeg-prueba`                                       |
| Collector         | `label_replace(label_replace(vector(1), "job", "postgres", "", ""), "collector", "stat_database", "", "")` | `>0`                                       | `collector=stat_database`; no aseverar base caída                                         |
| CPU global        | `vector(95.25)`                                                                                            | `>90`                                      | `95.25`, unidad %, alcance global                                                         |
| Memoria           | `vector(8.5)`                                                                                              | `<10`                                      | `8.50`, memoria disponible %, no CPU                                                      |
| TLS               | `vector(6.5)`                                                                                              | `<7`                                       | `6.50`, días restantes                                                                    |
| Sin identificador | `vector(1)`                                                                                                | `>0`                                       | Alcance global, sin URL inventada                                                         |
| Sin series        | `vector(1) < 0`                                                                                            | `>0`, `noDataState=Alerting` solo temporal | No debe fallar la plantilla ni confirmar salud; inspeccionar cómo Grafana presenta NoData |
| Recuperación      | `vector(0)` después de `vector(1)`                                                                         | `>0`                                       | Instancia vuelve a Normal; no asumir que retiene los probes iniciales                     |

- [x] **Paso 4:** Para comprobar un Error real, usar temporalmente A=`sipeg_invalid_metric(` en la regla de prueba: esperar error de sintaxis de consulta, no un mensaje de servicio caído con URL inventada. Registrar si Grafana omite/reutiliza anotaciones en ese estado; no prometer que el fallback siempre se muestra cuando no existe evaluación válida. Se usó la consulta inválida equivalente `vector(`.
- [x] **Paso 5:** En la UI local, abrir la vista previa de plantillas de notificación y seleccionar la instancia real para comprobar el cuerpo renderizado. La vista previa de notificación solo valida el transporte/presentación de anotaciones ya evaluadas, no sustituye los pasos anteriores. Probar Firing y Resolved; si se envía un correo de prueba, usar exclusivamente el sumidero SMTP local, nunca destinatarios reales sin permiso. Se comprobó mediante la API de vista previa con anotaciones reales; no se envió correo.
- [x] **Paso 6:** Verificar que no queda `{{`, `$values`, `<no value>` o error de plantilla en la salida, que los tres probes aparecen en líneas distinguibles y que no se incluyen etiquetas fuera de la lista permitida. Si la imagen fijada no soporta alguna construcción, detenerse y simplificar la plantilla; no actualizar Grafana como efecto secundario.
- [x] **Paso 7:** Eliminar únicamente la regla y carpeta temporales creadas para esta prueba. No borrar volúmenes ni configuración ajena. Guardar resultados de la matriz en el informe de ejecución.

### Tarea 5: documentación operativa y regresión

**Archivos:** `observability/README.md`, `CONTEXT.md`.

- [x] **Paso 1:** Añadir al README, después de la tabla de alertas, una sección `Cómo interpretar los correos` con el ejemplo 3.4, la interpretación de valores de la tabla 3.2 y estas consultas de disponibilidad:

```promql
probe_success{job=~"blackbox-internal|blackbox-public"}
probe_http_status_code{job=~"blackbox-internal|blackbox-public"}
probe_duration_seconds{job=~"blackbox-internal|blackbox-public"}
up{job=~"blackbox|blackbox-internal|blackbox-public"}
```

- [x] **Paso 2:** Documentar este procedimiento exacto: identificar `check` y `route` en el correo; buscar esas etiquetas en Explore en la ventana histórica de la alerta; comparar HTTP y éxito con el mismo check interno/público; si hay 403, recoger cabeceras desde el VPS y correlacionar Ray ID/hora en Security Events. Usar:

```bash
curl -sS --max-time 15 -D - -o /dev/null \
  https://api.sipeg-utp.com/api/v1/health
```

Explicar que un `200` no basta si falla el contenido y que `api-jwks` y `jwks` no son el mismo probe. No convertir HTTP 0 en diagnóstico definitivo. No automatizar excepciones de seguridad a partir de estas señales.

- [x] **Paso 3:** Documentar que Firing/Resolved describen la instancia de alerta, no una causa ni todos los servicios; no deducir tiempos exactos de recuperación a partir de «Observed …». Mantener la agrupación actual: 30s iniciales, 5m entre cambios de grupo y 4h de repetición. Una anotación que cambia no garantiza un correo inmediato nuevo; para saber cuándo se recuperó cada probe, consultar las series históricas.
- [x] **Paso 4:** Añadir al punto de verificación de `CONTEXT.md`: `Las 21 reglas existentes incluyen en sus anotaciones valores y etiquetas de las series afectadas mediante $values; se conserva la detección y agrupación clásicas. Lectura y límites: observability/README.md.` No documentar esto como ya desplegado si solo se implementó localmente.
- [x] **Paso 5:** Ejecutar las comprobaciones locales, sin actualizar snapshots:

```bash
pnpm exec vitest run src/observability/alert-messages.test.ts src/observability/provisioning.test.ts
pnpm test
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm exec prettier --check src/observability/alert-messages.test.ts observability/grafana/provisioning/alerting/metrics.yaml observability/grafana/provisioning/alerting/rules.yaml observability/README.md CONTEXT.md
git diff --check
```

Esperado: todas pasan. Si hay fallos preexistentes, registrarlos y distinguirlos de la tarea; no arreglar trabajo ajeno. Si Prettier exige cambios, aplicar formato solo a los archivos de esta tarea, no `pnpm run format` sobre todo el árbol.

- [x] **Paso 6:** Con el stack local disponible, ejecutar `pnpm run observability:check -- --metrics --window 10`. Esperado: sin fallos de provisioning/estado aplicado. El comando usa credenciales de Grafana del entorno; no imprimirlas. Los resultados de salud reales pueden fallar por servicios locales no levantados: distinguir esos fallos de errores de plantillas/provisioning. Ejecutado con 20 pass y 3 fail ajenos a las plantillas, detallados en la sección 7; no se declara una verificación integral verde.

No se cambian PromQL, scrapes ni reglas de Prometheus, por lo que no es necesario agregar fixtures PromQL ni regenerar OpenAPI. Si durante ejecución se decide cambiar consultas o condiciones, detenerse: amplía el alcance, invalida los snapshots y requiere diseño y pruebas propios, incluido `promtool`.

### Tarea 6: aplicación operativa posterior, con permiso separado

Esta tarea NO está autorizada por pedir un plan ni por aprobar la implementación local. No hacer commit, push ni despliegue sin petición explícita.

- [ ] **Paso 1:** Revisar el diff final y respaldar únicamente los archivos de provisioning que se van a sustituir en el VPS. No copiar `.env.prod` al repositorio ni mostrar `docker compose config` completo con secretos interpolados.
- [ ] **Paso 2:** Tras autorización del operador, aplicar solo Grafana con los archivos actuales de producción:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  up -d --no-deps --force-recreate grafana
```

Esto reinicia brevemente la evaluación/notificación de Grafana y podría interrumpir sus pendientes. No reinicia API, PostgreSQL, Tunnel ni Prometheus. No modifica `IMAGE_TAG` porque no se reconstruye la API; usar el valor ya configurado del despliegue.

- [ ] **Paso 3:** Revisar logs de Grafana para confirmar provisioning correcto, comprobar los UIDs esperados y el estado de evaluación. Verificar anotaciones exportadas en Grafana: deben conservar las variables literales hasta que se evalúen. Comprobar el panel de disponibilidad: en ausencia de otro incidente se esperan siete `probe_success=1` y siete estados HTTP 200. No provocar fallos en producción para obtener correos.
- [ ] **Paso 4:** Observar notificaciones reales durante 24h o el siguiente incidente. Confirmar legibilidad y ausencia de errores de plantilla, sin tratar la ausencia de correo como prueba completa de salud.
- [ ] **Paso 5:** Si el provisioning o las plantillas fallan, restaurar solo los dos archivos de alertas a partir del respaldo realizado para esta tarea y recrear exclusivamente Grafana con el mismo comando. No borrar el volumen de Grafana, silenciar reglas ni restaurar el repositorio completo.

## 5. Revisión final del plan

- [x] Hay cobertura de las 21 reglas y el caso de tres probes simultáneos.
- [x] Los guards se generaron antes de editar y permanecen sin cambios después.
- [x] Las pruebas de texto no se presentan como pruebas de ejecución de Go templates.
- [x] Se verificaron valores globales, etiquetas parciales, NoData, Error y recuperación en Grafana 13.2.2.
- [x] No se prometen códigos HTTP, causa automática ni recuperación individual por probe con el diseño clásico.
- [x] Se preservan `sipeg-disk-full`, `sipeg-5xx`, los otros UIDs y las políticas de notificación.
- [x] Solo se modificaron archivos previstos y las reglas de trabajo de `AGENTS.md` solicitadas expresamente; la producción y el trabajo previo del usuario siguen intactos.

## 6. Referencias consultadas

- Grafana, ejemplos de anotaciones clásicas y `$values.B0.Labels`: https://grafana.com/docs/grafana-cloud/observe-and-act/alert-and-measure-reliability/alerting/alerting-rules/templates/examples/
- Grafana, excepciones de interpolación en provisioning: https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/
- Grafana, validación de anotaciones: https://grafana.com/docs/grafana-cloud/observe-and-act/alert-and-measure-reliability/alerting/alerting-rules/templates/
- Grafana, vista previa de notificaciones: https://grafana.com/docs/grafana-cloud/observe-and-act/alert-and-measure-reliability/alerting/configure-notifications/template-notifications/manage-notification-templates/
- Cloudflare, contexto del incidente y limitaciones de Bot Fight Mode, actualizado 2026-08-03: https://developers.cloudflare.com/bots/get-started/bot-fight-mode/

Las referencias explican el mecanismo, pero la compatibilidad se acepta contra la imagen fijada en `compose.observability.yaml`, no contra una actualización implícita a la última versión.

## 7. Informe de ejecución — 2026-11-14

Tareas 1–5 ejecutadas localmente. La tarea 6 queda pendiente de autorización
independiente: no se hizo commit, push ni despliegue. El plan se trasladó al
repositorio y se verificó la eliminación del original externo, según petición
expresa. `AGENTS.md` ahora prohíbe toda escritura en modo Plan y las escrituras
fuera del directorio de trabajo en cualquier modo sin petición explícita.

### Pruebas y contrato preservado

- Los cuatro snapshots se generaron antes de editar YAML y nunca se actualizaron
  después. Se observó el fallo esperado por ausencia de `Detalle:` antes de
  implementar los mensajes.
- Los ocho tests de mensajes/provisioning pasan. Las 21 cabeceras coinciden con
  la tabla 3.2. Una comparación adicional con `HEAD`, excluyendo únicamente
  `annotations.description`, confirmó que todo el resto del YAML semántico
  permanece idéntico, incluidos `summary` y enlaces.
- `pnpm test`: **1760 pasan, 9 omitidos** (81 archivos pasan, 2 omitidos).
- `pnpm run typecheck`, `pnpm run build`, `pnpm run lint`, Prettier sobre los
  archivos de la tarea y `git diff --check`: pasan. El helper temporal se eliminó
  antes del lint final; no se incorporó una herramienta de producción nueva.

### Evaluación real en Grafana 13.2.2

Se pidió y obtuvo permiso para recrear solo Grafana local y arrancar Prometheus.
Se mantuvo `GF_SMTP_ENABLED=false` y se usó un destinatario ficticio local en el
contenedor; no se editaron archivos de entorno ni configuración SMTP versionada.
Las credenciales existentes se reutilizaron en memoria sin imprimirlas. API, DB y
otros servicios existentes no se recrearon. Grafana y Prometheus quedan activos
localmente; no se eliminaron volúmenes.

Adaptación del procedimiento: sin interacción de navegador, se usó la API local
de Grafana para crear reglas editables (`X-Disable-Provenance: true`) en una
carpeta temporal propia. Cada caso tuvo una regla independiente con consulta A
instantánea, condición B clásica y `for=0s`; las reglas del repositorio no se
alteraron. Las anotaciones se leyeron de las instancias evaluadas mediante
`/api/prometheus/grafana/api/v1/rules`. Se pasaron esas mismas anotaciones a
`/api/alertmanager/grafana/config/api/v1/templates/test` para verificar la vista
previa Firing y Resolved. No se enviaron correos.

| Caso                         | Resultado observado                                                 |
| ---------------------------- | ------------------------------------------------------------------- |
| Un probe                     | Una entrada `valor=1.00` con check, route, instance, job y module.  |
| Tres probes                  | Tres líneas distinguibles: api-health, api-jwks y jwks.             |
| Docker                       | Dos servicios distintos con service y project; valores 1.00 y 2.00. |
| Collector                    | collector=stat_database, sin inventar una caída de la base.         |
| CPU global                   | 95.25, unidad %, umbral >90 y alcance global.                       |
| Memoria                      | 8.50, memoria disponible %, umbral <10.                             |
| TLS                          | 6.50 días restantes, umbral <7.                                     |
| Sin identificador            | Valor global sin URL inventada.                                     |
| Sin series                   | `Alerting (NoData)`, health=ok, fallback neutral.                   |
| Consulta inválida `vector(`  | `Alerting (Error)`, health=error, fallback neutral.                 |
| Recuperación con vector(0)   | Normal; fallback neutral, sin fingir conservar probes anteriores.   |
| Vista previa de notificación | Firing y Resolved renderizan las anotaciones reales sin error.      |

Las dos primeras ejecuciones del helper se detuvieron por expectativas
incorrectas sobre los estados NoData de la API, no por fallos de plantilla. Se
pidió permiso para continuar; el usuario lo concedió. La ejecución final pasó la
matriz completa. Todas las reglas/carpetas sintéticas se limpiaron, también en
los intentos fallidos. Una lectura final comprobó que solo quedan las 21 reglas
originales y que sus anotaciones evaluadas no contienen `{{`, `$values`,
`<no value>` ni errores de expansión.

### Límites del chequeo integral local

`pnpm run observability:check -- --metrics --window 10`, después de limpiar las
reglas temporales: **20 pass, 3 fail, 3 info**. No es un resultado integral verde:

1. `alerts.group`: el verificador existente exige un único grupo, pero el
   provisioning actual contiene seis grupos. Las consultas, umbrales, estados y
   enlaces Loki sí pasan. No se cambió este verificador fuera de alcance.
2. `metrics.targets.health`: no se arrancaron Node Exporter, PostgreSQL Exporter,
   Telegraf ni Blackbox; la API existente tampoco está conectada a la nueva red
   privada de métricas. No se ampliaron los servicios autorizados para ocultarlo.
3. `metrics.metrics.names`: faltan las métricas de esas fuentes no disponibles.

Ambos datasources, los siete dashboards, la presencia de las quince reglas de
métricas y la ausencia de UIDs duplicados pasan. La ausencia de tráfico API en
la ventana solo produce un resultado informativo de ingesta. Queda como
seguimiento separado adaptar `alerts.group` al provisioning multigrupo y, si se
autoriza, validar con el stack completo. Ninguna de esas limitaciones invalida
la expansión sintética comprobada, ni demuestra salud de producción.
