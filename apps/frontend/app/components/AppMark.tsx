import { cn } from "~/lib/cn";

function AppMarkDot({ lg = false }: { lg?: boolean }) {
  return <span className={cn("lg-mark-dot", lg && "lg-mark-dot--lg")} aria-hidden="true" />;
}

export function AppMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold tracking-tight text-primary",
        lg ? "gap-2 text-base mb-7" : "gap-[7px]",
      )}
    >
      <AppMarkDot lg={lg} />
      Logarithmic
    </span>
  );
}
