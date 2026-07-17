import rawLogo from "../../assets/corigami.svg?raw";
import { cn } from "~/lib/cn";

/**
 * The corigami mark, rendered from the raw SVG so its fills and stroke can be
 * driven by CSS variables. Two variants differ only in how the stroke is drawn:
 * - `hero`: a light stroke color outlines the paths.
 * - `icon`: the stroke matches the primary fill, so the mark reads as a solid
 *   silhouette at small sizes.
 * The primary and secondary fills come from the `--color-logo-*` tokens in both
 * variants; the wrapper maps those tokens onto the SVG's internal `--logo-*`
 * variables.
 */
export function CorigamiLogo({
  variant = "icon",
  className,
}: {
  variant?: "hero" | "icon";
  className?: string;
}) {
  const style: Record<string, string> = {
    "--logo-primary": "var(--color-logo-primary)",
    "--logo-secondary": "var(--color-logo-secondary)",
    "--logo-stroke": variant === "hero" ? "var(--color-logo-stroke)" : "transparent",
  };
  return (
    <span
      className={cn("inline-flex", className)}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: rawLogo }}
    />
  );
}
