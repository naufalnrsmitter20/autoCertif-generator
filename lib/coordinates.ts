import { z } from "zod";

/**
 * Strict spatial geometry contract for participant-name placement.
 * Origin is TOP-LEFT (0,0) of the certificate template.
 * (xRatio, yRatio) is the horizontal and vertical CENTER anchor of the name field.
 */
export interface NamePlacement {
  xRatio: number;
  yRatio: number;
  maxWidthRatio: number;
  alignment: "left" | "center" | "right";
}

export const DEFAULT_NAME_PLACEMENT: NamePlacement = {
  xRatio: 0.5,
  yRatio: 0.5,
  maxWidthRatio: 0.7,
  alignment: "center",
};

/**
 * Recomputes valid horizontal center bounds implied by maxWidthRatio.
 * Name field width = maxWidthRatio; left = x - w/2 >= 0, right = x + w/2 <= 1.
 */
export function recomputeXBounds(maxWidthRatio: number): {
  minXRatio: number;
  maxXRatio: number;
} {
  const clampedWidth = Math.max(0.1, Math.min(1.0, maxWidthRatio));
  const half = clampedWidth / 2;
  return {
    minXRatio: half,
    maxXRatio: 1 - half,
  };
}

/**
 * Zod schema strictly enforcing the spatial contract and boundary constraints.
 * yRatio is validated as 0 <= yRatio <= 1.
 * maxWidthRatio is validated as 0.1 <= maxWidthRatio <= 1.0.
 * xRatio is validated as [maxWidthRatio/2, 1 - maxWidthRatio/2] within floating tolerance.
 */
export const namePlacementSchema = z
  .object({
    xRatio: z
      .number({ message: "xRatio must be a finite number" })
      .finite("xRatio must be finite"),
    yRatio: z
      .number({ message: "yRatio must be a finite number" })
      .finite("yRatio must be finite")
      .min(0, "yRatio must be between 0 and 1")
      .max(1, "yRatio must be between 0 and 1"),
    maxWidthRatio: z
      .number({ message: "maxWidthRatio must be a finite number" })
      .finite("maxWidthRatio must be finite")
      .min(0.1, "maxWidthRatio must be at least 0.1")
      .max(1.0, "maxWidthRatio must be at most 1.0"),
    alignment: z.enum(["left", "center", "right"]).default("center"),
  })
  .refine(
    (data) => {
      const { minXRatio, maxXRatio } = recomputeXBounds(data.maxWidthRatio);
      return data.xRatio >= minXRatio - 1e-4 && data.xRatio <= maxXRatio + 1e-4;
    },
    {
      message:
        "Participant name horizontal position (xRatio) exceeds bounds implied by maxWidthRatio",
      path: ["xRatio"],
    }
  );

/**
 * Clamps any incoming candidate coordinates into guaranteed valid bounds.
 */
export function clampPlacement(candidate: Partial<NamePlacement>): NamePlacement {
  const rawWidth =
    typeof candidate.maxWidthRatio === "number" && Number.isFinite(candidate.maxWidthRatio)
      ? candidate.maxWidthRatio
      : DEFAULT_NAME_PLACEMENT.maxWidthRatio;

  const maxWidthRatio = Math.max(0.1, Math.min(1.0, rawWidth));
  const { minXRatio, maxXRatio } = recomputeXBounds(maxWidthRatio);

  const rawX =
    typeof candidate.xRatio === "number" && Number.isFinite(candidate.xRatio)
      ? candidate.xRatio
      : DEFAULT_NAME_PLACEMENT.xRatio;
  const xRatio = Math.max(minXRatio, Math.min(maxXRatio, rawX));

  const rawY =
    typeof candidate.yRatio === "number" && Number.isFinite(candidate.yRatio)
      ? candidate.yRatio
      : DEFAULT_NAME_PLACEMENT.yRatio;
  const yRatio = Math.max(0, Math.min(1, rawY));

  return {
    xRatio,
    yRatio,
    maxWidthRatio,
    alignment: candidate.alignment === "left" || candidate.alignment === "right" ? candidate.alignment : "center",
  };
}

/**
 * Converts normalized placement ratios into actual pixel dimensions
 * on a given preview surface.
 */
export function ratioToPixelPlacement(
  placement: NamePlacement,
  surfaceWidth: number,
  surfaceHeight: number
): {
  centerX: number;
  centerY: number;
  width: number;
  left: number;
} {
  const width = placement.maxWidthRatio * surfaceWidth;
  const centerX = placement.xRatio * surfaceWidth;
  const centerY = placement.yRatio * surfaceHeight;
  const left = centerX - width / 2;

  return {
    centerX,
    centerY,
    width,
    left,
  };
}

/**
 * Converts pixel measurements back to clamped normalized ratios.
 */
export function pixelToRatioPlacement(
  centerX: number,
  centerY: number,
  width: number,
  surfaceWidth: number,
  surfaceHeight: number,
  alignment: NamePlacement["alignment"] = "center"
): NamePlacement {
  if (surfaceWidth <= 0 || surfaceHeight <= 0) {
    return DEFAULT_NAME_PLACEMENT;
  }

  const maxWidthRatio = width / surfaceWidth;
  const xRatio = centerX / surfaceWidth;
  const yRatio = centerY / surfaceHeight;

  return clampPlacement({
    xRatio,
    yRatio,
    maxWidthRatio,
    alignment,
  });
}

/**
 * Generates resolution-independent CSS percentage styles for the overlay box.
 */
export function placementToCSSStyle(placement: NamePlacement): {
  left: string;
  top: string;
  width: string;
  transform: string;
} {
  const leftPercent = Number(
    ((placement.xRatio - placement.maxWidthRatio / 2) * 100).toFixed(4)
  );
  const topPercent = Number((placement.yRatio * 100).toFixed(4));
  const widthPercent = Number((placement.maxWidthRatio * 100).toFixed(4));

  return {
    left: `${leftPercent}%`,
    top: `${topPercent}%`,
    width: `${widthPercent}%`,
    transform: "translateY(-50%)",
  };
}
