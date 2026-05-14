import { cn } from "~/lib/cn";

import styles from "./AppMark.module.css";

export function AppMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold tracking-tight text-primary",
        lg ? "gap-2 text-base mb-7" : "gap-[7px]",
      )}
    >
      <span className={cn(styles.dot, lg && styles.dotLg)} aria-hidden="true" />
      Logarithmic
    </span>
  );
}
