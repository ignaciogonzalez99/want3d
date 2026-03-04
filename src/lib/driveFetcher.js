const DEFAULT_DRIVE_PROXY = "https://r.jina.ai/http://";
const DRIVE_ENTRY_REGEX =
  /\[(.*?)\]\((https:\/\/drive\.google\.com\/(?:file\/d\/[a-zA-Z0-9_-]+\/view[^\s)]*|drive\/folders\/[a-zA-Z0-9_-]+[^\s)]*))\)/gms;
const IMAGE_NAME_REGEX = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;
const IMAGE_HINT_REGEX = /(jpeg|jpg|png|webp|gif|avif|bmp|heic|heif|image)/i;
const PROBE_TIMEOUT_MS = 10000;
const FOLDER_RETRY_ATTEMPTS = 5;
const FOLDER_RETRY_BASE_MS = 500;
const FOLDER_REQUEST_GAP_MS = 180;
const MAX_FOLDER_ERRORS_TO_LOG = 6;

const sourceAvailability = new Map();
const folderMarkdownCache = new Map();
const mappedImagesCache = new Map();
const mappedImagesInFlight = new Map();

const dedupe = (values) => [...new Set(values.filter(Boolean))];

function sleep(ms, signal) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timerId);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function toProxyUrl(targetUrl, proxyBase = DEFAULT_DRIVE_PROXY) {
  if (!proxyBase) {
    return targetUrl;
  }

  if (proxyBase.includes("{url}")) {
    return proxyBase.replace("{url}", encodeURIComponent(targetUrl));
  }

  if (proxyBase.endsWith("://")) {
    return `${proxyBase}${targetUrl.replace(/^https?:\/\//, "")}`;
  }

  return `${proxyBase}${targetUrl}`;
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
          url,
          rawLabel,
          previewHint
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

function buildSourceCandidates(fileId, previewHint) {
  const upgradedPreview = previewHint?.replace(/=s\d+/i, "=w2200");

  return dedupe([
    upgradedPreview,
    `https://lh3.googleusercontent.com/d/${fileId}=w2200`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w2200`,
    `https://drive.google.com/uc?export=view&id=${fileId}`
  ]);
}

function buildThumbCandidates(fileId, previewHint) {
  return dedupe([
    previewHint,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w900`,
    `https://lh3.googleusercontent.com/d/${fileId}=w900`
  ]);
}

async function fetchFolderMarkdown(
  folderId,
  {
    proxyBase,
    signal,
    retryAttempts = FOLDER_RETRY_ATTEMPTS,
    retryBaseDelayMs = FOLDER_RETRY_BASE_MS
  }
) {
  if (folderMarkdownCache.has(folderId)) {
    return folderMarkdownCache.get(folderId);
  }

  const targetUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}`;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    const response = await fetch(toProxyUrl(targetUrl, proxyBase), { signal });

    if (response.ok) {
      const markdown = await response.text();
      folderMarkdownCache.set(folderId, markdown);
      return markdown;
    }

    const isRetryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;

    if (!isRetryable || attempt === retryAttempts) {
      if (response.status === 429) {
        throw new Error(
          `Rate limit al leer carpeta ${folderId} (HTTP 429). Espera unos segundos y vuelve a intentar.`
        );
      }
      throw new Error(`No se pudo leer la carpeta ${folderId} (HTTP ${response.status}).`);
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSec = Number.parseInt(retryAfterHeader ?? "", 10);
    const backoffDelay =
      retryBaseDelayMs * 2 ** attempt + Math.floor(Math.random() * 240);
    const delayMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : backoffDelay;

    await sleep(delayMs, signal);
  }

  throw new Error(`No se pudo leer la carpeta ${folderId}.`);
}

async function probeImageSource(sourceUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  if (!sourceUrl) {
    return false;
  }

  if (sourceAvailability.has(sourceUrl)) {
    return sourceAvailability.get(sourceUrl);
  }

  if (typeof window === "undefined" || typeof Image === "undefined") {
    sourceAvailability.set(sourceUrl, true);
    return true;
  }

  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    let timerId = null;

    const settle = (value) => {
      if (done) {
        return;
      }

      done = true;
      if (timerId) {
        clearTimeout(timerId);
      }
      sourceAvailability.set(sourceUrl, value);
      resolve(value);
    };

    timerId = window.setTimeout(() => settle(false), timeoutMs);
    img.onload = () => settle(true);
    img.onerror = () => settle(false);
    img.decoding = "async";
    img.src = sourceUrl;
  });
}

async function resolveFirstAvailableSource(candidates) {
  for (const candidate of candidates) {
    const available = await probeImageSource(candidate);
    if (available) {
      return candidate;
    }
  }

  return null;
}

async function resolveMappedImage(item) {
  const src = await resolveFirstAvailableSource(item.sourceCandidates);
  if (!src) {
    return null;
  }

  const thumb =
    (await resolveFirstAvailableSource(item.thumbCandidates)) ??
    src;

  return {
    ...item,
    src,
    thumb
  };
}

export function extractDriveFolderId(folderUrl) {
  const match =
    folderUrl?.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ??
    folderUrl?.match(/^([a-zA-Z0-9_-]{10,})$/)?.[1];

  if (!match) {
    throw new Error("No se pudo extraer el ID de la carpeta de Google Drive.");
  }

  return match;
}

export async function mapDriveFolderImages(folderUrl, options = {}) {
  const {
    maxDepth = 4,
    proxyBase = DEFAULT_DRIVE_PROXY,
    signal,
    retryAttempts = FOLDER_RETRY_ATTEMPTS,
    requestGapMs = FOLDER_REQUEST_GAP_MS
  } = options;
  const rootFolderId = extractDriveFolderId(folderUrl);
  const cacheKey = `${rootFolderId}:${maxDepth}:${proxyBase}`;

  if (mappedImagesCache.has(cacheKey)) {
    return mappedImagesCache.get(cacheKey);
  }

  if (mappedImagesInFlight.has(cacheKey)) {
    return mappedImagesInFlight.get(cacheKey);
  }

  const task = (async () => {
    const queue = [{ id: rootFolderId, depth: 0, trail: [] }];
    const visitedFolders = new Set();
    const imageMap = new Map();
    const folderErrors = [];
    let lastFolderRequestAt = 0;

    while (queue.length > 0) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const current = queue.shift();
      if (!current || visitedFolders.has(current.id) || current.depth > maxDepth) {
        continue;
      }

      visitedFolders.add(current.id);

      if (lastFolderRequestAt > 0 && requestGapMs > 0) {
        const elapsedMs = Date.now() - lastFolderRequestAt;
        const waitMs = requestGapMs - elapsedMs;
        if (waitMs > 0) {
          await sleep(waitMs, signal);
        }
      }

      let markdown = "";
      try {
        lastFolderRequestAt = Date.now();
        markdown = await fetchFolderMarkdown(current.id, {
          proxyBase,
          signal,
          retryAttempts
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Error desconocido al leer carpeta.";
        if (current.id === rootFolderId && imageMap.size === 0) {
          throw new Error(message);
        }

        folderErrors.push({ id: current.id, message });
        continue;
      }

      const entries = parseDriveEntries(markdown);

      for (const entry of entries) {
        if (entry.type === "folder") {
          if (current.depth < maxDepth && !visitedFolders.has(entry.id)) {
            queue.push({
              id: entry.id,
              depth: current.depth + 1,
              trail: [...current.trail, entry.name || "Coleccion"]
            });
          }
          continue;
        }

        if (!looksLikeImage(entry) || imageMap.has(entry.id)) {
          continue;
        }

        imageMap.set(entry.id, {
          id: entry.id,
          title: entry.name || `Imagen ${imageMap.size + 1}`,
          folderPath: current.trail.join(" / ") || "Coleccion principal",
          driveViewUrl: entry.url,
          sourceCandidates: buildSourceCandidates(entry.id, entry.previewHint),
          thumbCandidates: buildThumbCandidates(entry.id, entry.previewHint)
        });
      }
    }

    if (!imageMap.size) {
      if (folderErrors.length) {
        throw new Error(folderErrors[0].message);
      }
      throw new Error("No se encontraron imagenes publicas dentro de la carpeta.");
    }

    const result = [...imageMap.values()];
    mappedImagesCache.set(cacheKey, result);

    if (folderErrors.length && typeof console !== "undefined") {
      console.warn(
        `Se omitieron ${folderErrors.length} carpetas por errores temporales del proxy.`,
        folderErrors.slice(0, MAX_FOLDER_ERRORS_TO_LOG)
      );
    }

    return result;
  })();

  mappedImagesInFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    mappedImagesInFlight.delete(cacheKey);
  }
}

export async function preloadMappedImages(mappedImages, options = {}) {
  const { concurrency = 6 } = options;
  if (!mappedImages.length) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, mappedImages.length));
  const output = new Array(mappedImages.length);
  let cursor = 0;

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (cursor < mappedImages.length) {
      const index = cursor;
      cursor += 1;

      const resolved = await resolveMappedImage(mappedImages[index]);
      if (resolved) {
        output[index] = resolved;
      }
    }
  });

  await Promise.all(workers);
  return output.filter(Boolean);
}

export { DEFAULT_DRIVE_PROXY };
