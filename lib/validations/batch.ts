import { z } from "zod";

export const batchNameSchema = z
  .string({
    message: "Batch name is required",
  })
  .trim()
  .min(1, "Batch name is required")
  .max(150, "Batch name must not exceed 150 characters");

export const batchInputSchema = z.object({
  name: batchNameSchema,
});

export type BatchInput = z.infer<typeof batchInputSchema>;
