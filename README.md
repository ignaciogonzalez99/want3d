# want3D

Galeria React + Framer Motion con assets locales sincronizados desde Google Drive.

## Flujo local

1. Sincroniza imagenes de Drive al proyecto:

```bash
npm run sync:drive
```

Si ya tienes las imagenes fisicas dentro de `public/gallery`, puedes regenerar solo el manifest:

```bash
npm run manifest:local
```

2. Inicia la app:

```bash
npm run dev
```

La galeria lee `public/gallery/manifest.json` y muestra los archivos locales en `public/gallery/...`.

## Drive privado

Si Google responde login/auth, ejecuta el sync con cookie de sesion:

PowerShell:

```powershell
$env:GOOGLE_DRIVE_COOKIE="SID=...; HSID=...; SSID=..."; npm run sync:drive
```

Opciones extra:

- `DRIVE_FOLDER_URL`: carpeta raiz de Drive.
- `DRIVE_MAX_DEPTH`: profundidad de subcarpetas.
- `DRIVE_DOWNLOAD_CONCURRENCY`: concurrencia de descarga.

## Descripciones por carpeta

El script `scripts/sync-drive-gallery.mjs` genera descripcion por categoria segun nombre de carpeta hija.
Puedes editar `categoryDescriptionRules` para personalizar los textos.

## GitHub Pages

Este proyecto incluye workflow en `.github/workflows/deploy-pages.yml`.

- Cada push a `main` publica automaticamente en GitHub Pages.
- URL esperada: `https://ignaciogonzalez99.github.io/want3d/`
