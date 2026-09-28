# Actualización de tesis: evolución del modelo de eventos de SIPEG UTP

## Introducción

Este documento resume las actualizaciones conceptuales más relevantes del diseño de SIPEG UTP, la plataforma de gestión de eventos académicos de la Universidad Tecnológica de Panamá. Se explican tres cambios: la ampliación del catálogo de tipos de evento, el cambio de terminología de "eventos" a "actividades", y la sustitución del concepto de "evento grande" por el de unidad organizativa.

El hilo conductor de todas las actualizaciones es el mismo: ordenar el modelo alrededor de la estructura real de la universidad y de una única noción clara de "actividad", eliminando ambigüedades que dificultaban el diseño, los permisos y los reportes.

---

## 1. Ampliación de los tipos de evento

La plataforma clasifica cada actividad según su naturaleza. El catálogo original contemplaba cuatro categorías: taller, seminario, charla y otro. La actualización incorpora cuatro tipos adicionales para cubrir mejor la variedad de actividades que se realizan en la universidad: conferencia, panel, curso y competencia.

| Tipo de evento | Descripción                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| Taller         | Actividad eminentemente práctica, orientada a la participación y al trabajo guiado.     |
| Seminario      | Sesión de estudio o discusión sobre un tema específico.                                 |
| Charla         | Exposición breve de carácter informativo o divulgativo.                                 |
| Conferencia    | Exposición formal de mayor alcance, a cargo de uno o varios especialistas.              |
| Panel          | Discusión entre varios participantes que aportan perspectivas distintas sobre un tema.  |
| Curso          | Actividad formativa estructurada, generalmente con varios encuentros o mayor extensión. |
| Competencia    | Actividad de carácter competitivo o de resolución de retos.                             |
| Otro           | Categoría abierta para actividades que no encajan en las anteriores.                    |

Un aspecto importante es que esta misma clasificación se utiliza tanto para las actividades ya planificadas como para las propuestas que envían los ponentes. De este modo, una propuesta y la actividad que de ella se derive comparten el mismo lenguaje de tipos, lo que evita reinterpretaciones y facilita el seguimiento del proceso.

Otro cambio de fondo es que el tipo dejó de ser un texto libre para convertirse en un **catálogo controlado**. Esto garantiza que todas las actividades se clasifiquen con las mismas categorías, mejora la calidad de los filtros y reportes, y permite que la interfaz muestre etiquetas y colores consistentes.

---

## 2. De "eventos" a "actividades"

En el diseño inicial convivían dos nociones distintas bajo la palabra "evento": un evento grande, que agrupaba otros, y un evento pequeño, que representaba cada sesión concreta. Esa doble acepción generaba confusión al hablar de reglas, permisos, asistencia y certificados, porque el término no dejaba claro a qué nivel se refería.

La actualización establece una terminología única:

- **Actividad** es el nombre oficial del evento concreto: la sesión con fecha, horario, ponentes, aula, capacidad y asistencia. Es la unidad sobre la que se inscriben los participantes y se emiten los certificados.
- **Evento** se conserva únicamente como sinónimo coloquial de actividad. No es un nivel ni una entidad aparte.

Este cambio simplifica el discurso del sistema: cuando se habla de "evento" en el lenguaje cotidiano de la universidad, el modelo lo interpreta como actividad. De esta manera desaparece el conflicto entre "evento grande" y "evento pequeño" que existía al inicio.

---

## 3. De "eventos grandes" a unidades organizativas

### El problema del diseño original

En la primera aproximación, un **evento grande** era un contenedor temporal: tenía fecha de inicio y de fin, pertenecía a una facultad y agrupaba uno o varios eventos pequeños. Presentaba varias limitaciones:

- La universidad no se modelaba como estructura permanente, sino a través de contenedores temporales.
- Un evento pequeño podía quedar sin un responsable institucional claro.
- La organización se representaba con catálogos separados para facultades y subdirecciones, lo que obligaba a duplicar reglas cada vez que aparecía un tipo nuevo de unidad.
- El agrupamiento dependía de fechas, lo que dificultaba representar actividades permanentes o programas sin límite temporal.

### El nuevo enfoque

La actualización reemplaza el "evento grande" por la **unidad organizativa** como punto de partida del modelo. Una unidad organizativa representa una parte estable de la universidad, como una facultad o una subdirección. Las facultades y las subdirecciones dejan de ser catálogos separados y pasan a ser un único concepto de unidad organizativa, diferenciadas únicamente por su tipo.

Sobre esa base se organiza el resto del modelo:

- Cada unidad organizativa cuenta con un **programa de eventos predeterminado y permanente**, creado automáticamente con la unidad y activo mientras la unidad lo esté.
- Además, es posible crear **programas adicionales**, normalmente asociados a un período o a una iniciativa concreta.
- Cada **actividad pertenece obligatoriamente a un programa**, y cada programa pertenece exactamente a una unidad organizativa.

Así, la función que antes cumplía el evento grande se divide ahora en dos conceptos más precisos:

1. La **unidad organizativa** aporta la pertenencia institucional y la permanencia.
2. El **programa de eventos** aporta el agrupamiento y la identidad del conjunto de actividades.

El resultado es que toda actividad tiene siempre una unidad responsable, aunque se trate de una actividad aislada o permanente, y que la estructura organizativa de la universidad se refleja directamente en el modelo.

---

## 4. El modelo actual en síntesis

La jerarquía conceptual del sistema queda así:

**Unidad organizativa → Programa de eventos → Actividad → Asistencia y certificado**

- La **unidad organizativa** (facultad o subdirección) es el nivel institucional permanente.
- El **programa de eventos** agrupa actividades y define el contexto de permisos; puede ser predeterminado (permanente) o adicional.
- La **actividad** es el evento concreto al que se inscriben las personas.
- La **asistencia** y el **certificado** cierran el ciclo de participación.

Los conceptos de la primera propuesta se transforman de la siguiente manera:

| Antes                                            | Ahora                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Evento grande                                    | Unidad organizativa (pertenencia institucional) + Programa de eventos (agrupamiento) |
| Evento pequeño                                   | Actividad                                                                            |
| Facultad y subdirección como catálogos separados | Unidad organizativa, con un tipo que las distingue                                   |
| Tipo de evento como texto libre                  | Catálogo de tipos controlado y ampliado                                              |
| Pertenencia temporal del conjunto                | Pertenencia institucional permanente a la unidad                                     |

---

## 5. Justificación e impacto

Estas actualizaciones aportan coherencia al proyecto de tesis y al sistema resultante:

- **Fidelidad institucional:** el modelo refleja la estructura real de la universidad (facultades y subdirecciones) en lugar de depender de eventos temporales.
- **Claridad conceptual:** existe una única noción de "actividad", sin ambigüedad entre niveles.
- **Permanencia y escalabilidad:** las unidades y sus programas predeterminados existen de forma estable, y agregar nuevos tipos de unidad no obliga a rediseñar el modelo.
- **Permisos y reportes consistentes:** al agrupar las actividades en programas y estos en unidades, la gestión de colaboradores, los filtros y las estadísticas se organizan de forma natural.
- **Mejor clasificación:** el catálogo ampliado y controlado de tipos de evento permite describir con precisión las actividades y las propuestas de los ponentes.

En conjunto, estas decisiones simplifican el diseño, lo acercan a la operación real de la universidad y preparan la plataforma para crecer sin rehacer sus fundamentos.
