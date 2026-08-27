import { useEffect, useMemo } from "react";
import { CanvasTexture, LinearFilter, RepeatWrapping } from "three";

export default function useCanvasTexture(draw, deps = [], size = 512, configure) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const nextTexture = new CanvasTexture(canvas);
    nextTexture.minFilter = LinearFilter;
    nextTexture.magFilter = LinearFilter;
    configure?.(nextTexture);
    return nextTexture;
    // configure is a creation-time hook for the texture object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    const canvas = texture.image;
    const ctx = canvas.getContext("2d");
    draw(ctx, canvas);
    // Three.js textures are imperative resources; this marks the redrawn canvas dirty.
    // eslint-disable-next-line react-hooks/immutability
    texture.needsUpdate = true;
    // deps is the caller-supplied redraw dependency list for this texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, ...deps]);

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

export function useRepeatingCanvasTexture(draw, deps = [], size = 512, repeat = [1, 1]) {
  return useCanvasTexture(
    draw,
    deps,
    size,
    (texture) => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(repeat[0], repeat[1]);
    },
  );
}
