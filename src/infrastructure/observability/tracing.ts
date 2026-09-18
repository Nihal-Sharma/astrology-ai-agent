export function startSpan(name: string): { end: () => void } {
  const start = Date.now();
  return {
    end: () => console.log(`[Trace] Span ${name} took ${Date.now() - start}ms`),
  };
}
