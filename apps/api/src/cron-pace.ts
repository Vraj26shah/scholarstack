/** Pacing for the cron jobs: spread over the run, and a keep-alive that shrugs off one slow answer. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The n-th job of a cron run starts about 4 s after the one before, plus up to 3 s at random. */
export const jitter = (n: number, random = Math.random) => sleep(n * 4000 + Math.floor(random() * 3000));

/** Up to three tries, waiting a random 3–8 s, then 8–15 s, between them. */
export async function keepAlive(ping: () => Promise<void>, wait = sleep, random = Math.random) {
  const pauses = [
    [3000, 5000],
    [8000, 7000],
  ] as const;
  for (let i = 0; ; i++) {
    try {
      return await ping();
    } catch (error) {
      const p = pauses[i];
      if (!p) throw error;
      await wait(p[0] + Math.floor(random() * p[1]));
    }
  }
}
