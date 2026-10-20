/**
 * Segmentação por clique (Segment Anything, versão SlimSAM) rodando no navegador com Transformers.js:
 * a imagem é analisada uma vez (embeddings) e cada conjunto de cliques devolve a máscara da área em milissegundos.
 * O modelo (~15 MB) vem do Hugging Face na primeira vez e fica no cache do navegador.
 */
export interface Prompt { x: number; y: number; positive: boolean }

const MODEL = 'Xenova/slimsam-77-uniform';
type Lib = typeof import('@huggingface/transformers');

export class Segmenter {
  private lib: Lib | null = null;
  private model: InstanceType<Lib['SamModel']> | null = null;
  private processor: Awaited<ReturnType<Lib['AutoProcessor']['from_pretrained']>> | null = null;
  private inputs: { original_sizes: [number, number][]; reshaped_input_sizes: [number, number][] } | null = null;
  private embeddings: Record<string, unknown> | null = null;
  width = 0; height = 0;

  async load() {
    if (this.model) return;
    this.lib = await import('@huggingface/transformers');
    this.lib.env.allowLocalModels = false;
    const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    this.model = await this.lib.SamModel.from_pretrained(MODEL, { device: webgpu ? 'webgpu' : 'wasm', dtype: webgpu ? 'fp32' : 'q8' }) as InstanceType<Lib['SamModel']>;
    this.processor = await this.lib.AutoProcessor.from_pretrained(MODEL);
  }

  /** Analisa a imagem (RGBA de um canvas); os cliques seguintes usam estas coordenadas. */
  async setImage(image: ImageData) {
    await this.load();
    const raw = new this.lib!.RawImage(image.data, image.width, image.height, 4).rgb();
    this.inputs = await (this.processor as unknown as (image: unknown) => Promise<typeof this.inputs & { pixel_values: unknown }>)(raw);
    this.embeddings = await this.model!.get_image_embeddings(this.inputs as never) as unknown as Record<string, unknown>;
    this.width = image.width; this.height = image.height;
  }

  /**
   * As três máscaras do SAM (1 dentro, do tamanho da imagem) para os cliques dados, da menor para a maior área, com
   * a nota de cada uma. Para chão a área grande costuma ser a certa (o clique cai num carro ou numa vaga).
   */
  async segment(prompts: Prompt[]): Promise<{ mask: Uint8Array; score: number; area: number }[]> {
    if (!this.embeddings || !this.inputs || !prompts.length) return [];
    const { Tensor } = this.lib!;
    const [rh, rw] = this.inputs.reshaped_input_sizes[0];
    const points = prompts.flatMap((p) => [(p.x / this.width) * rw, (p.y / this.height) * rh]);
    const input_points = new Tensor('float32', Float32Array.from(points), [1, 1, prompts.length, 2]);
    const input_labels = new Tensor('int64', BigInt64Array.from(prompts.map((p) => BigInt(p.positive ? 1 : 0))), [1, 1, prompts.length]);
    const out = await (this.model as unknown as (inputs: unknown) => Promise<{ pred_masks: unknown; iou_scores: { data: Float32Array } }>)({ ...this.embeddings, input_points, input_labels });
    const masks = await (this.processor as unknown as { post_process_masks: (m: unknown, o: unknown, r: unknown) => Promise<{ data: Uint8Array | boolean[]; dims: number[] }[]> }).post_process_masks(out.pred_masks, this.inputs.original_sizes, this.inputs.reshaped_input_sizes);
    const mask = masks[0]; const scores = Array.from(out.iou_scores.data);
    const [, count, h, w] = mask.dims; const size = w * h;
    const result: { mask: Uint8Array; score: number; area: number }[] = [];
    for (let k = 0; k < count; k++) {
      const m = new Uint8Array(size); let area = 0;
      for (let i = 0; i < size; i++) if (mask.data[k * size + i]) { m[i] = 1; area++; }
      if (area) result.push({ mask: m, score: scores[k], area });
    }
    return result.sort((a, b) => a.area - b.area);
  }
}
