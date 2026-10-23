/** Limita downloads/parse de GLB simultaneos, sem abandonar trabalhos ao falhar um deles. */
export function createLoadQueue(concurrency = 2) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concorrencia invalida');
  let active = 0;
  const pending: (() => void)[] = [];
  const run = () => { while (active < concurrency && pending.length) pending.shift()!(); };
  return <T>(job: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    pending.push(() => {
      active++;
      // Devolve um turno ao navegador entre parsers pesados.
      setTimeout(() => { Promise.resolve().then(job).then(resolve, reject).finally(() => { active--; run(); }); }, 0);
    });
    run();
  });
}

/** Uma carga sob demanda e compartilhada por todos os cliques na mesma torre. */
export function loadOnce<T>(job: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return () => pending ??= Promise.resolve().then(job);
}
