import { Cpu } from "lucide-react";

import { cn } from "@/lib/utils";
import { modelBrand, modelBrandIconUrl } from "@/lib/model-brand";

/**
 * Vendor logo for a model, falling back to a neutral chip for anything we have no artwork for.
 * Colored logos are left alone in dark mode; only the monochrome marks are inverted.
 */
export function ModelBrandIcon({ model, className }: { model: string | undefined; className?: string }) {
    const brand = modelBrand(model);
    if (!brand) return <Cpu className={cn("shrink-0 opacity-70", className)} />;
    return <img src={modelBrandIconUrl(brand)} alt="" aria-hidden draggable={false} className={cn("shrink-0 object-contain", brand.monochrome && "dark:invert", className)} />;
}
