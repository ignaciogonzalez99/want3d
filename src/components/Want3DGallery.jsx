import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadLocalGalleryManifest, preloadLocalImages } from "../lib/localGallery";

const INITIAL_PRELOAD_COUNT = 24;
const SWIPE_THRESHOLD = 12000;
const WHATSAPP_URL =
  "https://api.whatsapp.com/send?phone=59898778883&text=Hola,%20vengo%20desde%20want3D.%20Queria%20pedirte%20info%20de%20un%20producto.";
const INSTAGRAM_URL = "https://www.instagram.com/want3d.uy?igsh=dWpzd2RiM3h4Zzh3";

const swipePower = (offset, velocity) => Math.abs(offset) * velocity;
const wrapIndex = (value, length) => ((value % length) + length) % length;

const featuredVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 120 : -120,
    opacity: 0,
    scale: 0.98
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1]
    }
  },
  exit: (direction) => ({
    x: direction < 0 ? 120 : -120,
    opacity: 0,
    scale: 0.98,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 1, 1]
    }
  })
};

function LoaderScreen() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <motion.div
        className="w-full max-w-md text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.span
          className="inline-block text-xs uppercase tracking-[0.45em] text-white/45"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          Loading Gallery
        </motion.span>
        <motion.h1
          className="mt-3 bg-gradient-to-r from-white via-white to-sky-200 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl"
          initial={{ letterSpacing: "0.2em", opacity: 0 }}
          animate={{ letterSpacing: "-0.02em", opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          want3D
        </motion.h1>
        <div className="mx-auto mt-8 h-[1px] w-full max-w-[220px] overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full bg-gradient-to-r from-transparent via-white/90 to-transparent"
            initial={{ x: "-100%" }}
            animate={{ x: "110%" }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </motion.div>
    </div>
  );
}

function BurgerIcon() {
  return (
    <span className="flex flex-col gap-1.5" aria-hidden="true">
      <span className="h-[2px] w-5 rounded-full bg-white/85" />
      <span className="h-[2px] w-5 rounded-full bg-white/85" />
      <span className="h-[2px] w-5 rounded-full bg-white/85" />
    </span>
  );
}

export default function Want3DGallery() {
  const navigate = useNavigate();
  const { categorySlug } = useParams();

  const selectedCategorySlug = useMemo(
    () => (categorySlug ? decodeURIComponent(categorySlug).toLowerCase() : null),
    [categorySlug]
  );

  const [images, setImages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isHydrating, setIsHydrating] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [modalIndex, setModalIndex] = useState(null);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);

  const safeIndex = useMemo(() => {
    if (!images.length) {
      return 0;
    }
    return wrapIndex(activeIndex, images.length);
  }, [activeIndex, images.length]);

  const featuredImage = images[safeIndex] ?? null;
  const isModalOpen = modalIndex !== null && images.length > 0;
  const modalSafeIndex = useMemo(() => {
    if (!images.length || modalIndex === null) {
      return 0;
    }
    return wrapIndex(modalIndex, images.length);
  }, [images.length, modalIndex]);
  const modalImage = isModalOpen ? images[modalSafeIndex] ?? null : null;

  const selectedCategory = useMemo(() => {
    if (!selectedCategorySlug) {
      return null;
    }
    return categories.find((category) => category.slug === selectedCategorySlug) ?? null;
  }, [categories, selectedCategorySlug]);

  const paginate = useCallback(
    (nextDirection) => {
      if (!images.length) {
        return;
      }
      setDirection(nextDirection);
      setActiveIndex((prev) => prev + nextDirection);
    },
    [images.length]
  );

  const closeModal = useCallback(() => {
    setModalIndex(null);
  }, []);

  const paginateModal = useCallback(
    (nextDirection) => {
      if (!images.length) {
        return;
      }

      setModalIndex((prev) => {
        if (prev === null) {
          return safeIndex + nextDirection;
        }
        return prev + nextDirection;
      });
    },
    [images.length, safeIndex]
  );

  const handleCategoryNavigate = useCallback(
    (targetSlug) => {
      setIsCategoryMenuOpen(false);
      closeModal();

      const normalizedTarget = targetSlug ?? null;
      const sameTarget = normalizedTarget === selectedCategorySlug;

      if (!sameTarget) {
        if (!normalizedTarget) {
          navigate("/");
        } else {
          navigate(`/category/${normalizedTarget}`);
        }
      }

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    },
    [closeModal, navigate, selectedCategorySlug]
  );

  const scrollToTop = useCallback(() => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const loadGallery = async () => {
      try {
        setError("");
        const manifest = await loadLocalGalleryManifest({ signal: controller.signal });
        if (!mounted) {
          return;
        }

        const manifestCategories = manifest.categories ?? [];
        setCategories(manifestCategories);

        const categoryExists =
          !selectedCategorySlug ||
          manifestCategories.some((category) => category.slug === selectedCategorySlug);

        if (selectedCategorySlug && !categoryExists) {
          navigate("/", { replace: true });
          return;
        }

        const scopedImages = selectedCategorySlug
          ? manifest.images.filter((image) => image.categorySlug === selectedCategorySlug)
          : manifest.images;

        if (!scopedImages.length) {
          throw new Error("No hay imagenes para la categoria seleccionada.");
        }

        const initialBatch = scopedImages.slice(0, INITIAL_PRELOAD_COUNT);
        const remainingBatch = scopedImages.slice(INITIAL_PRELOAD_COUNT);

        const initialReady = await preloadLocalImages(initialBatch, { concurrency: 10 });
        if (!mounted) {
          return;
        }

        if (!initialReady.length) {
          throw new Error("No se pudieron precargar imagenes locales validas.");
        }

        setImages(initialReady);
        setIsInitialLoading(false);

        if (remainingBatch.length) {
          setIsHydrating(true);
          const hydrated = await preloadLocalImages(remainingBatch, { concurrency: 8 });
          if (mounted && hydrated.length) {
            setImages((prev) => [...prev, ...hydrated]);
          }
          if (mounted) {
            setIsHydrating(false);
          }
        }
      } catch (reason) {
        if (!mounted || reason?.name === "AbortError") {
          return;
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo cargar la galeria local desde manifest."
        );
        setIsInitialLoading(false);
        setIsHydrating(false);
      }
    };

    loadGallery();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [navigate, selectedCategorySlug]);

  useEffect(() => {
    setActiveIndex(0);
    setDirection(1);
    setModalIndex(null);
    setIsCategoryMenuOpen(false);
  }, [selectedCategorySlug]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }
    setIsCategoryMenuOpen(false);
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeModal();
      } else if (event.key === "ArrowRight") {
        paginateModal(1);
      } else if (event.key === "ArrowLeft") {
        paginateModal(-1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeModal, isModalOpen, paginateModal]);

  if (isInitialLoading) {
    return (
      <>
        <div className="grain-overlay" />
        <LoaderScreen />
      </>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-[var(--text)]">
      <div className="grain-overlay" />

      <motion.div
        className="pointer-events-none absolute left-[-10%] top-[-20%] z-0 h-[60vh] w-[60vh] rounded-full bg-cyan-300/10 blur-[130px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.7 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
      />

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-7 sm:px-8 sm:pb-20 sm:pt-9 lg:px-10">
        <motion.header
          className="mb-7 flex flex-col items-start justify-between gap-4 sm:mb-10 sm:flex-row sm:items-end"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <span className="text-xs uppercase tracking-[0.42em] text-white/45">Archive</span>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:mt-3 sm:text-5xl">want3D</h1>
            <p className="mt-2 text-xs uppercase tracking-[0.24em] text-cyan-100/70">
              {selectedCategory ? selectedCategory.name : "Vista general"}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
            <div className="max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
              {selectedCategory ? <p>{selectedCategory.description}</p> : null}
            </div>

            <button
              type="button"
              onClick={() => setIsCategoryMenuOpen(true)}
              className="flex items-center justify-center gap-3 self-end rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-xs uppercase tracking-[0.2em] text-white/85 transition hover:bg-white/[0.08]"
            >
              <BurgerIcon />
              Colecciones
            </button>
          </div>
        </motion.header>

        {error ? (
          <section className="rounded-3xl border border-rose-300/35 bg-rose-500/10 p-6 text-rose-100">
            <p className="text-sm sm:text-base">{error}</p>
          </section>
        ) : null}

        {featuredImage ? (
          <section
            id="featured-section"
            className="scroll-mt-6 rounded-[1.7rem] border border-white/10 bg-[var(--surface)] p-3 shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:rounded-[2rem] sm:p-6 lg:relative lg:left-1/2 lg:w-[calc(100vw-4rem)] lg:-translate-x-1/2 lg:rounded-[2.2rem] lg:p-7"
          >
            <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] uppercase tracking-[0.35em] text-white/40">Featured</p>
                <h2 className="mt-2 text-xl font-semibold sm:text-2xl">{featuredImage.title}</h2>
                <p className="mt-2 text-sm text-white/60">{featuredImage.folderDescription}</p>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto lg:hidden">
                <button
                  type="button"
                  onClick={() => paginate(-1)}
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-xs uppercase tracking-[0.2em] text-white/75 transition hover:bg-white/10"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => paginate(1)}
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-xs uppercase tracking-[0.2em] text-white/75 transition hover:bg-white/10"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="relative h-[44vh] min-h-[280px] overflow-hidden rounded-3xl border border-white/10 bg-black/30 sm:h-[52vh] sm:min-h-[330px] lg:h-[66vh] lg:min-h-[520px]">
              <AnimatePresence mode="wait" custom={direction} initial={false}>
                <motion.figure
                  key={featuredImage.id}
                  custom={direction}
                  variants={featuredVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.2}
                  onDragEnd={(_, { offset, velocity }) => {
                    const swipe = swipePower(offset.x, velocity.x);
                    if (swipe < -SWIPE_THRESHOLD) {
                      paginate(1);
                    } else if (swipe > SWIPE_THRESHOLD) {
                      paginate(-1);
                    }
                  }}
                  className="absolute inset-0"
                >
                  <img
                    src={featuredImage.src}
                    alt={featuredImage.title}
                    className="h-full w-full object-cover"
                    loading="eager"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-5">
                    <p className="text-sm font-medium text-white/90">{featuredImage.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-white/50">
                      {featuredImage.folderPath}
                    </p>
                  </figcaption>
                </motion.figure>
              </AnimatePresence>

              <button
                type="button"
                onClick={() => paginate(-1)}
                className="absolute left-4 top-1/2 z-20 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/30 text-3xl text-white/90 backdrop-blur-sm transition hover:bg-black/45 lg:flex"
                aria-label="Imagen anterior"
              >
                {'<'}
              </button>
              <button
                type="button"
                onClick={() => paginate(1)}
                className="absolute right-4 top-1/2 z-20 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/30 text-3xl text-white/90 backdrop-blur-sm transition hover:bg-black/45 lg:flex"
                aria-label="Imagen siguiente"
              >
                {'>'}
              </button>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 sm:mt-5">
              {images.map((image, index) => {
                const selected = index === safeIndex;
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => {
                      setDirection(index > safeIndex ? 1 : -1);
                      setActiveIndex(index);
                    }}
                    className={`group relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-xl border transition sm:h-20 sm:w-20 ${
                      selected
                        ? "border-cyan-200/80 ring-1 ring-cyan-100/70"
                        : "border-white/10 hover:border-white/35"
                    }`}
                  >
                    <img
                      src={image.thumb}
                      alt={image.title}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section id="archive-section" className="mt-10 scroll-mt-6 sm:mt-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold uppercase tracking-[0.2em] text-white/70">
              {selectedCategory ? selectedCategory.name : "Full Archive"}
            </h3>
            <p className="text-xs uppercase tracking-[0.28em] text-white/50">
              {images.length} imagenes
              {!selectedCategory ? ` / ${categories.length} colecciones` : ""}
              {isHydrating ? " / cargando mas..." : ""}
            </p>
          </div>

          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
            {images.map((image, index) => (
              <motion.article
                key={image.id}
                className="mb-4 break-inside-avoid"
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{
                  duration: 0.35,
                  delay: Math.min(index * 0.015, 0.25),
                  ease: [0.16, 1, 0.3, 1]
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setModalIndex(index);
                  }}
                  className="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-[var(--surface-2)] touch-manipulation"
                >
                  <img
                    src={image.thumb}
                    alt={image.title}
                    loading="lazy"
                    className="w-full object-cover transition duration-700 group-hover:scale-[1.03]"
                  />
                  <div className="border-t border-white/10 px-4 py-3">
                    <p className="truncate text-sm text-white/85">{image.title}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/45">
                      {image.category}
                    </p>
                  </div>
                </button>
              </motion.article>
            ))}
          </div>
        </section>
      </main>

      {!isModalOpen ? (
        <nav className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#070c14]/90 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:hidden">
          <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-emerald-300/35 bg-emerald-400/12 px-2 py-3 text-center text-[10px] uppercase tracking-[0.16em] text-emerald-100 active:scale-[0.98]"
            >
              WhatsApp
            </a>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-violet-300/35 bg-violet-400/12 px-2 py-3 text-center text-[10px] uppercase tracking-[0.16em] text-violet-100 active:scale-[0.98]"
            >
              Instagram
            </a>
            <button
              type="button"
              onClick={() => setIsCategoryMenuOpen(true)}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3 text-[10px] uppercase tracking-[0.16em] text-white/80 active:scale-[0.98]"
            >
              Menu
            </button>
            <button
              type="button"
              onClick={scrollToTop}
              className="rounded-2xl border border-cyan-200/30 bg-cyan-400/10 px-2 py-3 text-[10px] uppercase tracking-[0.16em] text-cyan-100 active:scale-[0.98]"
            >
              Top
            </button>
          </div>
        </nav>
      ) : null}

      <AnimatePresence>
        {isCategoryMenuOpen ? (
          <motion.div
            className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCategoryMenuOpen(false)}
          >
            <motion.aside
              className="absolute right-0 top-0 h-full w-[min(92vw,26rem)] border-l border-white/10 bg-[#08111b]/96 p-4 pb-[max(1.2rem,env(safe-area-inset-bottom))]"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3 pt-[max(0.6rem,env(safe-area-inset-top))]">
                <h3 className="text-sm uppercase tracking-[0.28em] text-white/80">Colecciones</h3>
                <button
                  type="button"
                  onClick={() => setIsCategoryMenuOpen(false)}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/80"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-4 flex h-[calc(100%-4.5rem)] flex-col gap-2 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => handleCategoryNavigate(null)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    !selectedCategorySlug
                      ? "border-cyan-200/40 bg-cyan-300/10"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-white/75">Todas</p>
                  <p className="mt-1 text-sm text-white/60">Vista completa de todas las carpetas.</p>
                </button>

                {categories.map((category) => {
                  const isSelected = selectedCategorySlug === category.slug;
                  return (
                    <button
                      key={category.slug}
                      type="button"
                      onClick={() => handleCategoryNavigate(category.slug)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        isSelected
                          ? "border-cyan-200/40 bg-cyan-300/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                      }`}
                      aria-current={isSelected ? "page" : undefined}
                    >
                      <p className="text-xs uppercase tracking-[0.2em] text-white/80">
                        {category.name} ({category.count})
                      </p>
                      <p className="mt-1 text-sm text-white/55">{category.description}</p>
                    </button>
                  );
                })}
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && modalImage ? (
          <motion.div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-0 backdrop-blur-md sm:p-7"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeModal}
          >
            <motion.div
              className="h-full w-full overflow-hidden rounded-none border-0 bg-[#0a1018]/98 shadow-[0_30px_120px_rgba(0,0,0,0.7)] sm:h-auto sm:max-w-6xl sm:rounded-3xl sm:border sm:border-white/15"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-3 border-b border-white/10 px-4 pb-3 pt-[max(0.8rem,env(safe-area-inset-top))] sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-4">
                <div className="max-w-3xl">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/45">
                    {modalImage.category}
                  </p>
                  <h4 className="mt-1 text-lg font-semibold text-white sm:text-xl">
                    {modalImage.title}
                  </h4>
                  <p className="mt-1 text-sm text-white/55">{modalImage.folderDescription}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <button
                    type="button"
                    onClick={() => paginateModal(-1)}
                    className="rounded-2xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:bg-white/10"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => paginateModal(1)}
                    className="rounded-2xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:bg-white/10"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection(modalSafeIndex > safeIndex ? 1 : -1);
                      setActiveIndex(modalSafeIndex);
                      closeModal();
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="rounded-2xl border border-cyan-200/35 bg-cyan-400/10 px-3 py-2.5 text-xs uppercase tracking-[0.2em] text-cyan-100 transition hover:bg-cyan-400/15"
                  >
                    Carrusel
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-2xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:bg-white/10"
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              <div className="relative h-[calc(100dvh-14rem)] min-h-[320px] overflow-hidden bg-black/40 sm:h-[72vh] sm:min-h-[360px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.img
                    key={modalImage.id}
                    src={modalImage.src}
                    alt={modalImage.title}
                    className="h-full w-full object-contain"
                    initial={{ opacity: 0.15, scale: 0.99 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0.2, scale: 0.99 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.08}
                    onDragEnd={(_, { offset, velocity }) => {
                      const swipe = swipePower(offset.x, velocity.x);
                      if (swipe < -SWIPE_THRESHOLD) {
                        paginateModal(1);
                      } else if (swipe > SWIPE_THRESHOLD) {
                        paginateModal(-1);
                      }
                    }}
                  />
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
