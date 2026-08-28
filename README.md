# NEXO — entrega privada para Iván Puentes

Portal estático para cifrar una exportación JSON de NEXO y producir un enlace de descarga destinado a **IVAN PUENTES**.

## Flujo urgente

1. Abre `/?preparar=1`.
2. Selecciona la exportación JSON completa de Rafael desde el panel administrativo de NEXO.
3. Copia el enlace cifrado generado y envíalo únicamente a Iván.
4. Iván escribe `IVAN PUENTES` y puede descargar JSON, TXT o XML.

El contenido se cifra en el navegador con AES-256-GCM. El fragmento `#...` del enlace no se envía al servidor. La acreditación por nombre no reemplaza una identidad fuerte; la seguridad principal es la posesión privada del enlace cifrado.
