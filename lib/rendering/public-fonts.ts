import { PRODUCTION_FONTS } from "./font-registry";

export interface PublicFontOption {
  id: string;
  family: string;
  label: string;
  weight: number;
  style: "normal" | "italic";
}

export function getAvailableProductionFonts(): PublicFontOption[] {
  return PRODUCTION_FONTS.map(({ id, family, label, weight, style }) => ({
    id,
    family,
    label,
    weight,
    style,
  }));
}
