# URAC · Disponibilidad

> **Historial, decisiones y cómo modificar el sistema:** ver [`docs/HISTORIAL.md`](docs/HISTORIAL.md).

App web (instalable en el teléfono) para que los integrantes de la **Unidad de Rescate Agreste Chena** del Cuerpo de Bomberos de San Bernardo informen su disponibilidad en las fases de **Monitoreo, Alerta y Movilización**.

> Apoya la gestión interna. **No reemplaza** el aviso por radio frecuencia 5-1 ni los procedimientos oficiales de activación.

## Perfiles

| Perfil | Qué hace |
| --- | --- |
| Rescatista | Responde *Disponible* (con hora de término) o *No disponible*. En Movilización indica hora estimada de llegada al Cuartel General. |
| Gerencia | Además, ve **solo totales**: disponibles, no disponibles, sin respuesta, cordada mínima y vigencia en 2/6/12 h. |
| Líder | Abre y cierra llamados, cambia de fase, ve el tablero con nombres y administra la nómina. |
| Administrador | Mismas facultades que el Líder (cuenta técnica de quien instala el sistema). |

## Cómo está armada (costo cero)

- **Firebase, plan Spark**: inicio de sesión con correo (verificado) y base de datos Firestore.
- **GitHub Pages**: publicación de la app.
- Sin servidor propio: los permisos los aplica `firestore.rules` en la base de datos.

## Datos

- `nomina/{correo}`: nombre, cargo, perfil, activo.
- `llamados/{id}`: fase, nivel, descripción, abierto, total de integrantes activos, plazo de reporte al SNO.
- `llamados/{id}/respuestas/{correo}`: estado, disponible hasta, hora estimada de llegada.
- `llamados/{id}/resumen/actual`: mapa anónimo de estados para la vista de Gerencia (sin nombres).

## Puesta en marcha

1. Pegar el bloque `firebaseConfig` en `config.js`.
2. Pegar `firestore.rules` en Firebase → Firestore Database → Reglas → Publicar.
3. Agregar el dominio de la app en Firebase → Authentication → Configuración → Dominios autorizados.
4. El primero en ingresar con correo confirmado puede registrarse como Administrador (una sola vez) y cargar la nómina.
