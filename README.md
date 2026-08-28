# NEXO — plataforma unificada para Rafael e Ivan

Aplicación canónica de NEXO que reúne el cuestionario fundador, el panel administrativo y el viewer cifrado para **Rafael Toledo Navarro** e **IVAN PUENTES**.

## Rutas canónicas

- `/` — portal unificado.
- `/cuestionario` — cuestionario fundador de 40 preguntas con persistencia privada.
- `/admin` — revisión y exportación administrativa.
- `/entrega` — viewer cifrado con descargas JSON, TXT y XML.

## Flujo urgente

1. Abre `/?preparar=1`.
2. Selecciona la exportación JSON completa de Rafael desde el panel administrativo de NEXO.
3. Copia el enlace cifrado y compártelo únicamente entre Rafael e Ivan.
4. El viewer acepta `RAFAEL TOLEDO NAVARRO` o `IVAN PUENTES` y permite descargar JSON, TXT o XML.

El contenido se cifra en el navegador con AES-256-GCM. El fragmento `#...` del enlace no se envía al servidor. La acreditación por nombre no reemplaza una identidad fuerte; la seguridad principal es la posesión privada del enlace cifrado.

## Build canónico

`npm run build` genera `dist/` sin dependencias externas. Esta configuración neutraliza los presets heredados de los proyectos Vercel anteriores y permite que todos consuman el mismo artefacto estático.
