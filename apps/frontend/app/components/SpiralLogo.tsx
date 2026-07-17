import rawLogo from "../../assets/logarithmic-spiral-evolute.svg?raw";
import { cn } from "~/lib/cn";

/**
 * The logarithmic-spiral evolute mark, rendered from the raw SVG so its fills,
 * strokes, and stroke widths can be driven by CSS variables. The filled spiral
 * uses the primary logo color and the solid overlay strokes use the secondary
 * color; the wrapper maps color tokens onto the SVG's internal `--logo-*`
 * variables.
 *
 * Two axes of variation:
 * - `variant` controls the dashed construction lines: `hero` draws them (dark
 *   `--logo-stroke`, light `--logo-dash`); `icon` makes them transparent so the
 *   mark reads clearly at small sizes.
 * - `tone` controls color: `brand` uses the magenta `--color-logo-*` tokens;
 *   `mono` recolors the mark grayscale (a dark spiral over light-grey lines) for
 *   the current monochrome palette.
 *
 * The injected SVG fills the wrapper's height, so callers size the mark by
 * setting a height on it (e.g. `h-20`).
 */
export function SpiralLogo({
  variant = "icon",
  tone = "brand",
  className,
}: {
  variant?: "hero" | "icon";
  tone?: "brand" | "mono";
  className?: string;
}) {
  const mono = tone === "mono";
  // Mono: a light-grey filled spiral over slightly darker grey construction
  // lines and baseline, so the mark reads as a soft grayscale figure.
  const primary = mono ? "var(--color-stark-sunken)" : "var(--color-logo-primary)";
  const secondary = mono ? "var(--color-muted)" : "var(--color-logo-secondary)";
  const stroke = mono ? "var(--color-muted)" : "var(--color-logo-stroke)";

  const style: Record<string, string> = {
    "--logo-primary": primary,
    "--logo-secondary": secondary,
    "--logo-stroke": variant === "hero" ? stroke : "transparent",
    "--logo-dash": variant === "hero" ? secondary : "transparent",
  };
  // The SVG's baseline defaults to a brand maroon; recolor it for the mono tone.
  if (mono) style["--logo-baseline"] = "var(--color-muted)";

  return (
    <span
      className={cn("inline-flex [&>svg]:block [&>svg]:h-full [&>svg]:w-auto", className)}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: rawLogo }}
    />
  );
}
