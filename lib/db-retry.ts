const TRANSIENT_CODES = new Set(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]);

function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return (code !== undefined && TRANSIENT_CODES.has(code)) ||
    [...TRANSIENT_CODES].some((transientCode) => error.message.includes(transientCode));
}

export async function withPrismaConnectionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt === 3) throw error;
      console.warn(`Transient database connection failure; retrying (${attempt}/2).`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error("Unreachable database retry state");
}
