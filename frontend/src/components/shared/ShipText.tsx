import { Text } from "@react-three/drei";
import type { ComponentProps } from "react";

import shipFontUrl from "../../assets/fonts/IMFellEnglish-Regular.ttf?url";

/**
 * 3D text in the ship's own face — the same IM Fell English the HTML panels use.
 *
 * Without an explicit `font`, troika resolves a generic sans-serif and downloads
 * it from a CDN at render time: wrong period for the ship, and blank signage in
 * the packaged desktop app when it is offline. The font is imported as an asset
 * so Vite rewrites the URL for the relative `file://` base Electron builds use.
 */
export default function ShipText(props: ComponentProps<typeof Text>) {
  return <Text font={shipFontUrl} {...props} />;
}
