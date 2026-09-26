import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { generateBatch } from "@/lib/inngest/functions/generate-batch";
import { generateParticipant } from "@/lib/inngest/functions/generate-participant";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateBatch, generateParticipant],
});
