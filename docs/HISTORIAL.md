# URAC · Sistema de Disponibilidad — Historial y diseño

Documento de referencia para retomar, mejorar o modificar la plataforma en el futuro.
Si continúas este proyecto con Claude u otra persona, **empieza leyendo este archivo**.

- **App en línea:** https://urac-cbsb.github.io/urac-disponibilidad/
- **Código:** repositorio `urac-cbsb/urac-disponibilidad` (GitHub, cuenta urac-cbsb)
- **Base de datos e inicio de sesión:** Firebase, proyecto `urac-disponibilidad-ab3a7`, plan **Spark (sin costo)**, Firestore en `southamerica-west1` (Santiago)
- **Creado:** 19 al 21 de octubre de 2026, con Claude, a partir del *Procedimiento de Activación URAC v1.0*, el organigrama y la nómina de la Unidad.

> Es un sistema **distinto y más simple** que la plataforma URAC del repositorio `urac-cbsb/Urac` (Supabase). Este solo gestiona la disponibilidad del personal por incidente.

---

## 1. Para qué sirve

Cada integrante de la URAC (Unidad de Rescate Agreste Chena, Cuerpo de Bomberos de San Bernardo) informa desde su teléfono si está **Disponible** (y hasta cuándo) o **No disponible** cuando hay un incidente en fase de **Monitoreo, Alerta, Movilización o Desmovilización**. El Líder y la Gerencia ven en línea cuánto personal hay y cómo se arman las cordadas.

## 2. Perfiles y permisos

| Perfil | Cómo se obtiene | Qué ve / hace |
| --- | --- | --- |
| **Rescatista** | Perfil en la app = Rescatista | Su ficha (foto, función, perfil de cordada), responde Disponible/No disponible, ve clima e imagen del lugar. |
| **Gerencia** | **Automático por función**: Jefe de Operaciones, Jefe de Planificación, Jefe de Logística, Jefe de Administración y Finanzas, Líder Alfa, Líder Bravo, LUMED | Pestaña **Resumen**: totales, Gerencia (puesto de mando), cordadas con nombres, lista de disponibles. No edita. |
| **Líder** | Perfil en la app = Líder | **Panel**: abrir incidente, cambiar fase, cerrar, ingreso manual de disponibilidad, imagen del lugar, informes, eliminar informes. |
| **Líder de Unidad** | Líder + función "Líder de Unidad" | Todo lo del Líder **+ editar la Nómina** (agregar, editar, fotos, eliminar). |
| **Jefe de Operaciones** | Líder + función "Jefe de Operaciones" (subrogante) | Todo lo del Líder **excepto** editar la Nómina. |
| **Administrador** | Perfil en la app = Administrador (el primero que se registra) | Todo lo anterior **+ Importar lista de integrantes**. **No integra la URAC**: no responde ni cuenta en totales ni cordadas. |

- **Informes:** los generan Líder, Administrador, Jefe de Operaciones y Jefe de Planificación, en cualquier etapa (preliminar) o al cierre.
- **Funciones únicas** (no se pueden repetir): Líder de Unidad, los 4 jefes, Líder Alfa, Líder Bravo, LUMED, Oficial de Seguridad.
- Los permisos se aplican en la **base de datos** (`firestore.rules`), no solo en la pantalla.

## 3. Reglas de funcionamiento (decisiones tomadas)

**Incidentes y fases**
- Solo puede haber **un incidente activo** a la vez. Botón: **ABRIR INCIDENTE** (fase inicial Monitoreo, Alerta o Movilización; nivel Local, Regional o SNO; descripción; lugar).
- Fases: **Monitoreo → Alerta → Movilización → Desmovilización** → **CERRAR INCIDENTE**.
- Nivel SNO en Alerta: se muestra el plazo de **4 h** para reportar al SNO.
- La palabra "llamado" se reemplazó por **"incidente"** en toda la interfaz. (Internamente, en código y base de datos, la colección sigue llamándose `llamados`.)
- Al abrir un incidente se prepara un mensaje de WhatsApp; **al cambiar de fase NO** se abre WhatsApp.

**Disponibilidad**
- El rescatista elige: 2 h, 4 h, 8 h, 24 h, **Hasta nuevo aviso** u hora exacta; o No disponible.
- La disponibilidad **se mantiene aunque cambie la fase**. Solo deja de contar si vence la hora elegida o se cierra el incidente.
- "Sin respuesta" nunca se cuenta como "No disponible".
- **Ingreso manual:** el Líder/Administrador toca **EDITAR** en la fila del integrante (se abre ahí mismo) y registra su disponibilidad; queda en la bitácora como "Ingreso manual por…".
- Se eliminó la pregunta de hora de llegada al Cuartel (cada uno debe llegar dentro del plazo del POE).

**Gerencia y cordadas**
- Bloque **GERENCIA** (antes "Puesto de Comando"): Líder de Unidad, Jefe de Operaciones, Jefe de Planificación, Jefe de Logística, Jefe de Administración y Finanzas y LUMED. **No integran cordadas.**
- **Cordadas solo con rescatistas**, de **6** integrantes, se arman **solas por orden de disponibilidad** (Alfa, Bravo, Charlie, Delta). Si hay perfiles de cordada, se procura repartir uno de cada tipo por cordada. Sin puestos fijos ni "FALTA".
- Oficial de Seguridad, Líder Alfa y Líder Bravo entran a las cordadas como un rescatista más.
- Perfiles de cordada: Líder de cordada, Navegante, Técnico, Sanitario, Comunicaciones, **Seguridad** (id interno `apoyo`).
- Contadores (Disponibles / No disponibles / Sin respuesta, cordada mínima de 6): un solo total general.

**Pantallas**
- Sin incidente activo la pantalla queda limpia: sin textos, sin clima.
- **Clima** (Open-Meteo, gratuito): solo en Monitoreo, Alerta y Movilización. Activación Local → próximas 24 h; Regional/SNO → 5 días del lugar del incidente.
- **Imagen georreferencial del lugar**: la carga el Líder/Administrador; la ven todos.
- Encabezado: escudo URAC + escudo Cuerpo de Bomberos de San Bernardo, mismo tamaño, sin texto. **Cerrar sesión** siempre visible.
- Paleta: negro, amarillo URAC (#F5C400), blanco; verde = disponible, rojo = no disponible. Estilo simple tipo VIPER (estado con un toque).
- En la Nómina se usa **"Función"** (no "Cargo"). Se **elimina** al integrante (no hay "desactivar").
- Botones "Compartir incidente" y "Recordar a sin respuesta": discretos (borde gris).

**Informe del incidente**
- Datos del incidente, fases con **inicio y término** (sin duración), disponibilidad, tabla **Gerencia**, cordadas, imagen del lugar y **bitácora** completa. Se imprime o guarda en PDF. Los informes de incidentes cerrados se pueden **eliminar**.

## 4. Cómo está armada

| Archivo | Contenido |
| --- | --- |
| `index.html` | Página, vista previa para WhatsApp (escudo URAC). |
| `app.js` | Toda la lógica y pantallas (JavaScript sin compilar). |
| `styles.css` | Estilos. |
| `nomina.js` | Listas fijas: funciones, perfiles de cordada, funciones únicas, Gerencia, puesto de mando. |
| `clima.js` | Pronóstico Open-Meteo. |
| `config.js` | Datos públicos del proyecto Firebase (no son contraseñas). |
| `firestore.rules` | **Reglas de seguridad.** Cada cambio aquí hay que pegarlo en Firebase → Firestore → Reglas → Publicar. |
| `logo.png`, `cbsb.png`, `icon-*.png`, `og-urac*.jpg` | Escudos e íconos. |

**Datos en Firestore**
- `nomina/{correo}`: nombre, cargo (función), rol (rescatista/lider/admin), cordada, activo.
- `fotos/{correo}`: foto del integrante (reducida).
- `llamados/{id}`: incidente (fase, nivel, descripción, lugar, abierto, fechas).
  - `respuestas/{correo}`, `resumen/actual` (vista de Gerencia), `eventos/` (bitácora), `adjuntos/mapa`.
- `config/inicial`: marca que ya existe Administrador.

**Publicación:** GitHub Pages desde la rama `main`. Al subir cambios al repositorio, la app se actualiza sola en 1–10 minutos.

**Privacidad:** el repositorio es **público**. Nunca guardar correos, teléfonos ni datos personales en el código; viven solo en Firebase, protegidos por las reglas.

## 5. Cómo hacer cambios en el futuro

1. Abrir una conversación nueva con Claude y decir: *"Quiero modificar el sistema URAC Disponibilidad, repositorio `urac-cbsb/urac-disponibilidad`. Lee `docs/HISTORIAL.md`."*
2. Claude necesita acceso a GitHub (cuenta urac-cbsb; la app de Claude debe tener permiso sobre este repositorio en github.com/settings/installations).
3. Si el cambio toca permisos o datos, Claude entregará reglas nuevas: pegarlas en Firebase → Firestore → Reglas → **Publicar**.
4. Pedir que se agregue el cambio a la sección 6 de este archivo.

## 6. Registro de cambios

| Fecha | Cambio |
| --- | --- |
| 2026-10-19 | Primera versión: perfiles Rescatista/Gerencia/Líder, incidentes con fases, disponibilidad con plazo, Panel, Resumen, Nómina, WhatsApp. |
| 2026-10-19 | Escudo oficial URAC; fotos de integrantes; perfiles de cordada; clima 24 h / 5 días. |
| 2026-10-19 | Administrador fuera de la URAC; pantalla vacía sin fase; fase Desmovilización; imagen del lugar; bitácora e informe; escudo CBSB; Gerencia ve nombres; sin hora de llegada. |
| 2026-10-19 | Cerrar sesión siempre visible; informe en cualquier etapa (Líder, Admin, Jefe Op., Jefe Planif.). |
| 2026-10-20 | Eliminar informes; un solo incidente activo; ingreso manual de disponibilidad; "Panel"; "incidente" en vez de "llamado"; botón ABRIR INCIDENTE. |
| 2026-10-20 | Editar nombre y función; funciones de mando únicas; Gerencia automática por función. |
| 2026-10-20 | Ingreso manual dentro de la fila; botones de WhatsApp discretos. |
| 2026-10-20 | Cordadas automáticas por orden de disponibilidad; bloque Gerencia (puesto de mando) fuera de cordadas; perfil "Seguridad"; "Función"; solo Admin y Líder de Unidad editan la Nómina; eliminar integrante. |
| 2026-10-20 | Disponibilidad se mantiene entre fases; sin WhatsApp al cambiar de fase. |
| 2026-10-20 | Importar lista de integrantes (solo Administrador); vista previa con escudo URAC en WhatsApp. |
| 2026-10-21 | Este documento de historial. |

## 7. Pendientes conocidos

- Acortar el enlace (opción recomendada: renombrar el repositorio a `urac-cbsb.github.io`; o subdominio `urac.cbsb.cl`).
- Avisos automáticos al teléfono (push): requieren plan de pago en Firebase; hoy el aviso es por radio 5-1 y WhatsApp.
- Eliminar un integrante no borra su cuenta de acceso de Firebase (solo su ficha); se hace desde la consola si se requiere.
