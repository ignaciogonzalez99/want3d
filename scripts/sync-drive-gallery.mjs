import fs from "node:fs/promises";
import path from "node:path";

const DRIVE_FOLDER_URL =
  process.env.DRIVE_FOLDER_URL ??
  "https://drive.google.com/drive/folders/1F_kY3TuiLT46cIeX5PhpWfgP5FCgLQeu?usp=sharing";
const DRIVE_PROXY_BASE = process.env.DRIVE_PROXY_BASE ?? "https://r.jina.ai/http://";
const GOOGLE_DRIVE_COOKIE = process.env.GOOGLE_DRIVE_COOKIE ?? "";
const OUTPUT_DIR = path.resolve(process.cwd(), "public", "gallery");
const TEMP_OUTPUT_DIR = path.resolve(process.cwd(), "public", ".gallery-sync-tmp");
const PREVIOUS_OUTPUT_DIR = path.resolve(process.cwd(), "public", ".gallery-sync-prev");
const MAX_DEPTH = Number.parseInt(process.env.DRIVE_MAX_DEPTH ?? "6", 10);
const FETCH_RETRIES = Number.parseInt(process.env.DRIVE_FETCH_RETRIES ?? "6", 10);
const DOWNLOAD_RETRIES = Number.parseInt(process.env.DRIVE_DOWNLOAD_RETRIES ?? "4", 10);
const DOWNLOAD_CONCURRENCY = Number.parseInt(
  process.env.DRIVE_DOWNLOAD_CONCURRENCY ?? "6",
  10
);
const REQUEST_GAP_MS = Number.parseInt(process.env.DRIVE_REQUEST_GAP_MS ?? "180", 10);
const MAX_LOGGED_ERRORS = 8;

const DRIVE_ENTRY_REGEX =
  /\[(.*?)\]\((https:\/\/drive\.google\.com\/(?:file\/d\/[a-zA-Z0-9_-]+\/view[^\s)]*|drive\/folders\/[a-zA-Z0-9_-]+[^\s)]*))\)/gms;
const IMAGE_NAME_REGEX = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;
const IMAGE_HINT_REGEX = /(jpeg|jpg|png|webp|gif|avif|bmp|heic|heif|image)/i;
const VALID_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
  "heic",
  "heif"
]);

const contentTypeExtensionMap = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);

const categoryDescriptionRules = [
  [/^a color$/i, "Modelos impresos y pintados a mano con terminacion final en color."],
  [/anime/i, "Personajes y estilos anime en distintas variantes de modelado."],
  [/chibi/i, "Figuras estilo chibi con enfoque caricaturesco y proporciones compactas."],
  [/lamparas?/i, "Lamparas y objetos de iluminacion fabricados en impresion 3D."],
  [/pokeball/i, "Pokeballs tematicas inspiradas en franquicias y estilos personalizados."],
  [/pokemon\s*mecha/i, "Pokemon reinterpretados con estetica mecha y mecanica."],
  [/setup/i, "Accesorios y piezas para setup de escritorio y organizacion."],
  [/variado/i, "Coleccion mixta con piezas de distintas categorias y acabados."]
];

const folderMarkdownCache = new Map();

const downloadRequestHeaders = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  referer: "https://drive.google.com/"
};

if (GOOGLE_DRIVE_COOKIE) {
  downloadRequestHeaders.cookie = GOOGLE_DRIVE_COOKIE;
}

function extractDriveFolderId(folderUrl) {
  const match =
    folderUrl?.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ??
    folderUrl?.match(/^([a-zA-Z0-9_-]{10,})$/)?.[1];

  if (!match) {
    throw new Error("No se pudo extraer el ID de la carpeta de Google Drive.");
  }

  return match;
}

function toProxyUrl(targetUrl) {
  if (!DRIVE_PROXY_BASE) {
    return targetUrl;
  }

  if (DRIVE_PROXY_BASE.includes("{url}")) {
    return DRIVE_PROXY_BASE.replace("{url}", encodeURIComponent(targetUrl));
  }

  if (DRIVE_PROXY_BASE.endsWith("://")) {
    return `${DRIVE_PROXY_BASE}${targetUrl.replace(/^https?:\/\//, "")}`;
  }

  return `${DRIVE_PROXY_BASE}${targetUrl}`;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLabel(rawLabel = "") {
  return rawLabel
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/[`*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPreviewHint(rawLabel = "") {
  return rawLabel.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/)?.[1] ?? null;
}

function parseDriveEntries(markdown = "") {
  const entries = [];
  DRIVE_ENTRY_REGEX.lastIndex = 0;

  let match = DRIVE_ENTRY_REGEX.exec(markdown);
  while (match) {
    const rawLabel = match[1] ?? "";
    const url = match[2] ?? "";
    const name = normalizeLabel(rawLabel);
    const previewHint = extractPreviewHint(rawLabel);

    if (url.includes("/file/d/")) {
      const fileId = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1];
      if (fileId) {
        entries.push({
          type: "file",
          id: fileId,
          name,
          rawLabel,
          previewHint,
          driveViewUrl: url
        });
      }
    } else if (url.includes("/drive/folders/")) {
      const folderId = url.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/)?.[1];
      if (folderId) {
        entries.push({
          type: "folder",
          id: folderId,
          name
        });
      }
    }

    match = DRIVE_ENTRY_REGEX.exec(markdown);
  }

  return entries;
}

function looksLikeImage(fileEntry) {
  if (!fileEntry || fileEntry.type !== "file") {
    return false;
  }

  if (IMAGE_NAME_REGEX.test(fileEntry.name ?? "")) {
    return true;
  }

  return IMAGE_HINT_REGEX.test(fileEntry.rawLabel ?? "");
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildSourceCandidates(fileId, previewHint) {
  const upgradedPreview = previewHint?.replace(/=s\d+/i, "=w2200");
  return dedupe([
    upgradedPreview,
    `https://lh3.googleusercontent.com/d/${fileId}=w2200`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
    `https://drive.google.com/uc?export=view&id=${fileId}`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w2200`
  ]);
}

async function fetchFolderMarkdown(folderId) {
  if (folderMarkdownCache.has(folderId)) {
    return folderMarkdownCache.get(folderId);
  }

  const targetUrl = toProxyUrl(`https://drive.google.com/embeddedfolderview?id=${folderId}`);

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const response = await fetch(targetUrl);
    if (response.ok) {
      const markdown = await response.text();
      folderMarkdownCache.set(folderId, markdown);
      return markdown;
    }

    const status = response.status;
    const retryable = status === 408 || status === 429 || status >= 500;
    if (!retryable || attempt === FETCH_RETRIES) {
      throw new Error(`No se pudo leer la carpeta ${folderId} (HTTP ${status}).`);
    }

    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 600 * 2 ** attempt + Math.floor(Math.random() * 280);
    await sleep(delayMs);
  }

  throw new Error(`No se pudo leer la carpeta ${folderId}.`);
}

function slugify(value, fallback = "item") {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || fallback;
}

function stripExtension(fileName = "") {
  return fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, "");
}

function categoryDescription(categoryName) {
  for (const [pattern, description] of categoryDescriptionRules) {
    if (pattern.test(categoryName)) {
      return description;
    }
  }
  return `Coleccion de ${categoryName} con piezas y variaciones impresas en 3D.`;
}

function getExtensionFromName(fileName = "") {
  const ext = fileName.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (!ext) {
    return null;
  }
  if (ext === "jpeg") {
    return "jpg";
  }
  return VALID_EXTENSIONS.has(ext) ? ext : null;
}

function getExtensionFromContentType(contentType = "") {
  const normalizedType = contentType.split(";")[0].trim().toLowerCase();
  return contentTypeExtensionMap.get(normalizedType) ?? null;
}

function getExtensionFromUrl(fileUrl = "") {
  const cleanUrl = fileUrl.split("?")[0];
  const ext = cleanUrl.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (!ext) {
    return null;
  }
  return VALID_EXTENSIONS.has(ext) ? ext : null;
}

async function downloadImageBuffer(candidateUrl) {
  let lastFailureReason = "unknown";

  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt += 1) {
    const response = await fetch(candidateUrl, {
      headers: downloadRequestHeaders
    });
    const status = response.status;
    const finalUrl = response.url ?? candidateUrl;

    if (!response.ok) {
      lastFailureReason = `http-${status}`;
      if (finalUrl.includes("accounts.google.com")) {
        lastFailureReason = "auth-required";
      }
      const retryable = status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === DOWNLOAD_RETRIES) {
        break;
      }
      const delayMs = 500 * 2 ** attempt + Math.floor(Math.random() * 220);
      await sleep(delayMs);
      continue;
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      if (finalUrl.includes("accounts.google.com")) {
        lastFailureReason = "auth-required";
      } else {
        lastFailureReason = `content-type-${contentType || "none"}`;
      }
      break;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      lastFailureReason = "empty-buffer";
      break;
    }

    return {
      buffer,
      contentType,
      candidateUrl: finalUrl
    };
  }

  return {
    buffer: null,
    contentType: "",
    candidateUrl,
    error: lastFailureReason
  };
}

async function crawlDrive(rootFolderId) {
  const queue = [{ id: rootFolderId, depth: 0, trail: [], categoryName: "Coleccion principal" }];
  const visited = new Set();
  const files = [];
  const folderErrors = [];
  let lastRequestAt = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id) || current.depth > MAX_DEPTH) {
      continue;
    }

    visited.add(current.id);

    if (lastRequestAt > 0 && REQUEST_GAP_MS > 0) {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < REQUEST_GAP_MS) {
        await sleep(REQUEST_GAP_MS - elapsed);
      }
    }

    lastRequestAt = Date.now();
    let markdown = "";
    try {
      markdown = await fetchFolderMarkdown(current.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      if (current.id === rootFolderId && files.length === 0) {
        throw new Error(message);
      }
      folderErrors.push({ id: current.id, message });
      continue;
    }

    const entries = parseDriveEntries(markdown);
    for (const entry of entries) {
      if (entry.type === "folder") {
        const childName = entry.name || "Coleccion";
        const nextTrail = [...current.trail, childName];
        const nextCategoryName = current.depth === 0 ? childName : current.categoryName;

        queue.push({
          id: entry.id,
          depth: current.depth + 1,
          trail: nextTrail,
          categoryName: nextCategoryName
        });
        continue;
      }

      if (!looksLikeImage(entry)) {
        continue;
      }

      files.push({
        ...entry,
        folderPath: current.trail.join(" / ") || "Coleccion principal",
        categoryName: current.categoryName
      });
    }
  }

  return { files, folderErrors, visitedCount: visited.size };
}

async function downloadAndWriteImage(file, index, outputDir) {
  const candidateSources = buildSourceCandidates(file.id, file.previewHint);
  const categorySlug = slugify(file.categoryName, "coleccion");
  const safeTitle = slugify(stripExtension(file.name || `imagen-${index + 1}`), "imagen");
  const folderDescription = categoryDescription(file.categoryName);
  const candidateErrors = [];

  for (const candidate of candidateSources) {
    const result = await downloadImageBuffer(candidate);
    if (!result.buffer) {
      candidateErrors.push(`${candidate} -> ${result.error}`);
      continue;
    }

    const ext =
      getExtensionFromName(file.name) ??
      getExtensionFromContentType(result.contentType) ??
      getExtensionFromUrl(candidate) ??
      "jpg";

    const fileName = `${String(index + 1).padStart(4, "0")}-${safeTitle}-${file.id.slice(0, 8)}.${ext}`;
    const relativePath = path.posix.join("gallery", categorySlug, fileName);
    const absolutePath = path.join(outputDir, categorySlug, fileName);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, result.buffer);

    return {
      id: file.id,
      title: file.name || `Imagen ${index + 1}`,
      category: file.categoryName,
      categorySlug,
      folderPath: file.folderPath,
      folderDescription,
      driveViewUrl: file.driveViewUrl,
      sourceUsed: result.candidateUrl,
      src: `/${relativePath}`,
      thumb: `/${relativePath}`
    };
  }

  throw new Error(candidateErrors.join(" | "));
}

async function run() {
  const startedAt = Date.now();
  const rootFolderId = extractDriveFolderId(DRIVE_FOLDER_URL);

  console.log(`[sync] root folder: ${rootFolderId}`);
  console.log(`[sync] crawling drive structure...`);

  const { files, folderErrors, visitedCount } = await crawlDrive(rootFolderId);
  if (!files.length) {
    throw new Error("No se encontraron imagenes en la carpeta indicada.");
  }

  console.log(`[sync] folders visited: ${visitedCount}`);
  console.log(`[sync] candidate images: ${files.length}`);

  await fs.rm(TEMP_OUTPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(TEMP_OUTPUT_DIR, { recursive: true });

  const downloadedImages = [];
  const failedImages = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, DOWNLOAD_CONCURRENCY) }, async () => {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      const file = files[index];

      try {
        const manifestImage = await downloadAndWriteImage(file, index, TEMP_OUTPUT_DIR);
        downloadedImages[index] = manifestImage;
      } catch (error) {
        failedImages.push({
          id: file.id,
          title: file.name,
          folderPath: file.folderPath,
          reason: error instanceof Error ? error.message : "unknown-error"
        });
      }

      if ((index + 1) % 20 === 0 || index + 1 === files.length) {
        console.log(`[sync] processed ${index + 1}/${files.length}`);
      }
    }
  });

  await Promise.all(workers);

  const images = downloadedImages.filter(Boolean);
  if (!images.length) {
    if (failedImages.length) {
      console.warn("[sync] sample failures:", failedImages.slice(0, 3));
    }
    const authFailures = failedImages.filter((item) => item.reason?.includes("auth-required"));
    if (authFailures.length) {
      throw new Error(
        "Google esta pidiendo autenticacion para descargar los archivos. Haz publicos los archivos o ejecuta sync con GOOGLE_DRIVE_COOKIE para modo privado."
      );
    }
    throw new Error("No se pudo descargar ninguna imagen.");
  }

  const categoriesMap = new Map();
  for (const image of images) {
    const current = categoriesMap.get(image.categorySlug) ?? {
      name: image.category,
      slug: image.categorySlug,
      description: image.folderDescription,
      count: 0
    };
    current.count += 1;
    categoriesMap.set(image.categorySlug, current);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceFolderUrl: DRIVE_FOLDER_URL,
    rootFolderId,
    totalImages: images.length,
    categories: [...categoriesMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    images
  };

  const manifestPath = path.join(TEMP_OUTPUT_DIR, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await fs.rm(PREVIOUS_OUTPUT_DIR, { recursive: true, force: true });
  try {
    await fs.rename(OUTPUT_DIR, PREVIOUS_OUTPUT_DIR);
  } catch {
    // Ignore when there is no previous gallery directory.
  }
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.rename(TEMP_OUTPUT_DIR, OUTPUT_DIR);
  await fs.rm(PREVIOUS_OUTPUT_DIR, { recursive: true, force: true });

  console.log(`[sync] downloaded images: ${images.length}`);
  if (failedImages.length) {
    console.warn(`[sync] failed images: ${failedImages.length}`);
    console.warn(failedImages.slice(0, MAX_LOGGED_ERRORS));
  }
  if (folderErrors.length) {
    console.warn(`[sync] folders with temporary errors: ${folderErrors.length}`);
    console.warn(folderErrors.slice(0, MAX_LOGGED_ERRORS));
  }
  console.log(`[sync] manifest: ${manifestPath}`);
  console.log(`[sync] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

run().catch((error) => {
  fs.rm(TEMP_OUTPUT_DIR, { recursive: true, force: true }).catch(() => {});
  console.error("[sync] error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
