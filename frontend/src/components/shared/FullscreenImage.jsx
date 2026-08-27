import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FullscreenImageContext } from "./useFullscreenImage";
import styles from "./FullscreenImage.module.css";

const MotionDiv = motion.div;

// Normalises every caller into one shape: a list of images plus an optional
// gallery header. One image renders the single layout; many render the grid.
function normalizePayload(payload) {
  if (!payload) {
    return null;
  }

  const images = Array.isArray(payload.images)
    ? payload.images
    : payload.src || payload.label
      ? [
          {
            src: payload.src,
            label: payload.label,
            caption: payload.caption,
            extra: payload.extra,
          },
        ]
      : [];

  const cleaned = images.filter((image) => image && (image.src || image.label));
  if (cleaned.length === 0) {
    return null;
  }

  return {
    title: payload.title || "",
    subtitle: payload.subtitle || "",
    images: cleaned,
    // Optional: callers can be told when the viewer is dismissed, so a scene can
    // drop whatever selection it put the user into.
    onClose: typeof payload.onClose === "function" ? payload.onClose : null,
  };
}

function ImageInfo({ image }) {
  if (!image.label && !image.caption && !image.extra) {
    return null;
  }

  return (
    <div className={styles.info}>
      {image.label ? <h3>{image.label}</h3> : null}
      {image.caption ? <p>{image.caption}</p> : null}
      {image.extra ?? null}
    </div>
  );
}

export default function FullscreenImageProvider({ children }) {
  const [payload, setPayload] = useState(null);
  const payloadRef = useRef(null);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  const open = useCallback((next) => {
    setPayload(normalizePayload(next));
  }, []);
  const close = useCallback(() => {
    const notify = payloadRef.current?.onClose;
    setPayload(null);
    notify?.();
  }, []);

  const viewer = useMemo(() => ({ open, close }), [open, close]);

  useEffect(() => {
    if (!payload) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [payload, close]);

  const isGallery = Boolean(payload && payload.images.length > 1);
  const single = payload ? payload.images[0] : null;

  return (
    <FullscreenImageContext.Provider value={viewer}>
      {children}
      <AnimatePresence>
        {payload ? (
          <MotionDiv
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          >
            <MotionDiv
              className={`${styles.container} ${isGallery ? styles.galleryContainer : ""}`}
              initial={{ scale: 0.86 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.86 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.close}
                onClick={close}
                aria-label="Close"
              >
                ✕
              </button>

              {payload.title || payload.subtitle ? (
                <div className={styles.header}>
                  {payload.title ? <h3>{payload.title}</h3> : null}
                  {payload.subtitle ? <p>{payload.subtitle}</p> : null}
                </div>
              ) : null}

              {isGallery ? (
                <div className={styles.grid}>
                  {payload.images.map((image, index) => (
                    <figure key={image.id ?? index} className={styles.gridItem}>
                      {image.src ? (
                        <img
                          src={image.src}
                          alt={image.label || ""}
                          className={styles.gridImage}
                        />
                      ) : (
                        <div className={styles.fallback}>{image.label}</div>
                      )}
                      <ImageInfo image={image} />
                    </figure>
                  ))}
                </div>
              ) : (
                <>
                  {single.src ? (
                    <img
                      src={single.src}
                      alt={single.label || ""}
                      className={styles.image}
                    />
                  ) : (
                    <div className={styles.fallback}>{single.label}</div>
                  )}
                  <ImageInfo image={single} />
                </>
              )}
            </MotionDiv>
          </MotionDiv>
        ) : null}
      </AnimatePresence>
    </FullscreenImageContext.Provider>
  );
}
