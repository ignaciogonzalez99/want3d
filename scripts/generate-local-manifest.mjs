import fs from "node:fs/promises";
import path from "node:path";

const GALLERY_DIR = path.resolve(process.cwd(), "public", "gallery");
const MANIFEST_PATH = path.join(GALLERY_DIR, "manifest.json");
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".heic",
  ".heif"
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

function categoryDescription(categoryName) {
  for (const [pattern, description] of categoryDescriptionRules) {
    if (pattern.test(categoryName)) {
      return description;
    }
  }
  return `Coleccion de ${categoryName} con piezas y variaciones impresas en 3D.`;
}

function fixMojibake(value) {
  if (!/[ÃÂ]/.test(value)) {
    return value;
  }

  try {
    const decoded = Buffer.from(value, "latin1").toString("utf8");
    if (/[^\u0000-\u007f]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // Keep original value if decoding fails.
  }

  return value;
}

function toUrlPath(...segments) {
  const encoded = segments.map((segment) => encodeURIComponent(segment));
  return encoded.join("/");
}

function isImageFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

function stripFileExtension(fileName) {
  return String(fileName).replace(/\.[a-z0-9]{2,5}$/i, "");
}

async function listCategoryDirs() {
  const entries = await fs.readdir(GALLERY_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function run() {
  const categoryDirs = await listCategoryDirs();
  const images = [];
  const categories = [];
  let imageCounter = 0;

  for (const categoryName of categoryDirs) {
    const folderPath = path.join(GALLERY_DIR, categoryName);
    const displayCategoryName = fixMojibake(categoryName);
    const files = (await fs.readdir(folderPath))
      .filter(isImageFile)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!files.length) {
      continue;
    }

    const categorySlug = slugify(displayCategoryName, "coleccion");
    const folderDescription = categoryDescription(displayCategoryName);

    categories.push({
      name: displayCategoryName,
      slug: categorySlug,
      description: folderDescription,
      count: files.length
    });

    for (const fileName of files) {
      imageCounter += 1;
      images.push({
        id: `${categorySlug}-${imageCounter}`,
        title: stripFileExtension(fileName),
        category: displayCategoryName,
        categorySlug,
        folderPath: displayCategoryName,
        folderDescription,
        src: toUrlPath("gallery", categoryName, fileName),
        thumb: toUrlPath("gallery", categoryName, fileName)
      });
    }
  }

  if (!images.length) {
    throw new Error("No se encontraron imagenes locales en public/gallery.");
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "local-filesystem",
    rootPath: "gallery",
    totalImages: images.length,
    categories,
    images
  };

  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[manifest] images: ${images.length}`);
  console.log(`[manifest] categories: ${categories.length}`);
  console.log(`[manifest] file: ${MANIFEST_PATH}`);
}

run().catch((error) => {
  console.error("[manifest] error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
