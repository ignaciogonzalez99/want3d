const IMAGE_TIMEOUT_MS = 12000;

const imageAvailability = new Map();

function withBasePath(pathname = "") {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = String(pathname).replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`;
}

function resolveAssetPath(value = "") {
  const raw = String(value).trim();
  if (!raw) {
    return "";
  }

  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:")) {
    return raw;
  }

  return withBasePath(raw);
}

function stripFileExtension(value = "") {
  return String(value).replace(/\.[a-z0-9]{2,5}$/i, "");
}

function preloadImage(url, timeoutMs = IMAGE_TIMEOUT_MS) {
  if (!url) {
    return Promise.resolve(false);
  }

  if (imageAvailability.has(url)) {
    return Promise.resolve(imageAvailability.get(url));
  }

  if (typeof Image === "undefined") {
    imageAvailability.set(url, true);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timerId = null;

    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
      imageAvailability.set(url, value);
      resolve(value);
    };

    timerId = window.setTimeout(() => done(false), timeoutMs);
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.decoding = "async";
    image.src = url;
  });
}

export async function loadLocalGalleryManifest({ signal } = {}) {
  const response = await fetch(withBasePath("gallery/manifest.json"), {
    signal,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `No se pudo leer el manifest local (HTTP ${response.status}). Ejecuta "npm run manifest:local" para regenerarlo desde public/gallery.`
    );
  }

  const manifest = await response.json();
  const images = Array.isArray(manifest?.images) ? manifest.images : [];

  if (!images.length) {
    throw new Error("El manifest local no contiene imagenes.");
  }

  return {
    generatedAt: manifest.generatedAt,
    categories: Array.isArray(manifest?.categories) ? manifest.categories : [],
    images: images.map((image, index) => ({
      id: image.id ?? `local-${index + 1}`,
      title: stripFileExtension(image.title ?? `Imagen ${index + 1}`),
      src: resolveAssetPath(image.src),
      thumb: resolveAssetPath(image.thumb ?? image.src),
      folderPath: image.folderPath ?? image.category ?? "Coleccion principal",
      folderDescription:
        image.folderDescription ??
        `Coleccion de ${image.category ?? "modelos"} en piezas impresas en 3D.`,
      category: image.category ?? "Coleccion principal",
      categorySlug: image.categorySlug ?? "coleccion-principal"
    }))
  };
}

export async function preloadLocalImages(images, options = {}) {
  const { concurrency = 8 } = options;
  if (!images.length) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, images.length));
  const output = new Array(images.length);
  let cursor = 0;

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (cursor < images.length) {
      const index = cursor;
      cursor += 1;

      const image = images[index];
      const srcOk = await preloadImage(image.src);
      if (!srcOk) {
        continue;
      }

      if (image.thumb && image.thumb !== image.src) {
        await preloadImage(image.thumb);
      }

      output[index] = image;
    }
  });

  await Promise.all(workers);
  return output.filter(Boolean);
}
