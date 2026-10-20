import { BadRequestException, ConflictException, GatewayTimeoutException, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiProvider, AssetKind, GenerationMode, JobKind, JobStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrganizationContext } from '../common/organization-context';
import { PrismaService } from '../common/prisma.service';
import { assertCanEdit } from '../common/roles';
import { DevelopmentsService } from '../developments/developments.service';
import { storageRoot } from '../public/public.service';
import { BlenderError, loadKtx2, parseGlb, resolveBlenderPath, resolveTowerScript, runBlender, towerInput, towerNodeCode } from './tower-glb';

/**
 * Gera o GLB paramétrico de uma torre com o Blender local e o registra como nova versão do modelo 3D.
 * Usa apenas tabelas existentes: GenerationJob (andamento/erro), DevelopmentAsset MODEL_3D + ModelVersion
 * (via DevelopmentsService.addAsset, igual ao upload) e ThreeDGeneration (modo PARAMETRIC) ligando os dois.
 */
@Injectable()
export class ModelGenerationService {
  private readonly logger = new Logger(ModelGenerationService.name);
  /** Uma geração por torre de cada vez (o Blender usa bastante CPU/memória). */
  private readonly running = new Set<string>();

  constructor(private readonly prisma: PrismaService, private readonly developments: DevelopmentsService) {}

  /** ctivate: grava o GLB em model3d.glb da torre, para o visualizador público usá-lo no lugar do modelo paramétrico. */
  async generateTowerModel(context: OrganizationContext, buildingId: string, options: { activate?: boolean } = {}) {
    assertCanEdit(context);
    const building = await this.prisma.building.findFirst({ where: { id: buildingId, development: { organizationId: context.organizationId, archivedAt: null } }, include: { floors: { select: { number: true } } } });
    if (!building) throw new NotFoundException('Torre não encontrada');

    let blender: string; let script: string;
    try { blender = resolveBlenderPath(); script = resolveTowerScript(); }
    catch (error) { throw new ServiceUnavailableException((error as Error).message); }

    if (this.running.has(buildingId)) throw new ConflictException('Já existe uma geração de modelo em andamento para esta torre');
    this.running.add(buildingId);
    const input = towerInput(building, building.floors.map((f) => f.number));
    const job = await this.prisma.generationJob.create({ data: { developmentId: building.developmentId, kind: JobKind.MODEL_GENERATION, status: JobStatus.PROCESSING, provider: 'blender', input: { buildingId, params: input } as Prisma.InputJsonValue, attempts: 1, createdById: context.userId, startedAt: new Date() } });
    const workdir = await mkdtemp(join(tmpdir(), 'vistahub-blender-'));
    let stored: string | null = null;
    try {
      const inputPath = join(workdir, 'tower.json');
      const outputPath = join(workdir, 'tower.glb');
      await writeFile(inputPath, JSON.stringify(input), 'utf8');
      // Com o KTX-Software (KTX_PATH), as texturas saem do Blender em JPEG e são comprimidas para KTX2.
      const ktx2 = await loadKtx2().catch(() => null);
      const run = await runBlender({ blender, script, input: inputPath, output: outputPath, timeoutMs: Number(process.env.BLENDER_TIMEOUT_MS) || 180_000, env: ktx2 ? { VH_GLB_IMAGES: 'JPEG' } : undefined });
      let buffer: Buffer = await readFile(outputPath).catch(() => { throw new BlenderError('INVALID_OUTPUT', 'O Blender terminou sem gerar o arquivo GLB', run.stderr); });
      let textures = ktx2 ? 'JPEG' : 'WebP';
      if (ktx2) {
        try { buffer = await ktx2.compress(buffer); textures = 'KTX2 (BasisLZ/ETC1S)'; }
        catch (error) { this.logger.warn(`Torre ${building.code}: compressão KTX2 falhou, texturas ficam em JPEG: ${(error as Error).message}`); }
      }
      const glb = parseGlb(buffer);
      const nodeNames = (glb.json.nodes ?? []).map((n) => n.name ?? '');
      const code = towerNodeCode(building.code);
      const unitNodes = nodeNames.filter((n) => n.startsWith(`T${code}-F`)).length;
      if (!nodeNames.includes(`T${code}`)) throw new BlenderError('INVALID_OUTPUT', `GLB gerado sem o nó raiz T${code}`, run.stderr);

      const fileName = `T${code}-blender.glb`;
      const storageKey = `${building.developmentId}/${randomUUID()}-${fileName}`;
      await mkdir(join(storageRoot(), building.developmentId), { recursive: true });
      stored = join(storageRoot(), storageKey);
      await writeFile(stored, buffer, { flag: 'wx' });
      const technical = { generator: 'blender', script: 'scripts/blender/build_tower.py', durationMs: run.durationMs, unitNodes, nodes: nodeNames.length, textures, ...(run.result ?? {}) };
      // addAsset ativa a primeira versão do empreendimento; o GLB de uma torre só é ativado manualmente (Estúdio 3D).
      const hadViewer = await this.prisma.viewerConfiguration.findUnique({ where: { developmentId: building.developmentId }, select: { id: true } });
      const asset = await this.developments.addAsset(context, building.developmentId, {
        kind: AssetKind.MODEL_3D, originalName: fileName, storageKey, mimeType: 'model/gltf-binary', byteSize: BigInt(buffer.length),
        checksum: createHash('sha256').update(buffer).digest('hex'),
        metadata: { storage: 'local-private', source: 'blender-parametric', buildingId, params: input, ...technical } as Prisma.InputJsonValue,
      }, { buildingId, label: `${building.name} — modelo paramétrico (Blender)` });
      const modelVersion = asset.modelVersion!;
      const warnings = blenderWarnings(run.stderr);
      const [finishedJob, , version] = await this.prisma.$transaction([
        this.prisma.generationJob.update({ where: { id: job.id }, data: { status: JobStatus.SUCCEEDED, completedAt: new Date(), output: { assetId: asset.id, modelVersionId: modelVersion.id, ...technical } as Prisma.InputJsonValue } }),
        this.prisma.threeDGeneration.create({ data: { developmentId: building.developmentId, generationJobId: job.id, modelVersionId: modelVersion.id, mode: GenerationMode.PARAMETRIC, provider: AiProvider.PARAMETRIC, providerModel: 'blender/build_tower.py', requestedConfiguration: input as Prisma.InputJsonValue, technicalMetadata: technical as Prisma.InputJsonValue } }),
        this.prisma.modelVersion.update({ where: { id: modelVersion.id }, data: { warnings } }),
        ...(hadViewer ? [] : [this.prisma.viewerConfiguration.updateMany({ where: { developmentId: building.developmentId, activeModelVersionId: modelVersion.id }, data: { activeModelVersionId: null } })]),
      ]);
      if (options.activate) await this.setViewerModel(context, buildingId, { assetId: asset.id, version: version.version });
      this.logger.log(`Torre ${building.code}: GLB gerado em ${run.durationMs} ms (versão ${version.version})${options.activate ? ', em uso no visualizador' : ''}`);
      return { job: finishedJob, asset: { id: asset.id, originalName: asset.originalName, byteSize: buffer.length.toString() }, modelVersion: version, unitNodes, durationMs: run.durationMs, stats: run.result };
    } catch (error) {
      if (stored) await unlink(stored).catch(() => undefined);
      const message = (error as Error).message;
      const stderr = error instanceof BlenderError ? error.stderr : '';
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: JobStatus.FAILED, completedAt: new Date(), error: [message, stderr.slice(-8000)].filter(Boolean).join('\n\n') } }).catch(() => undefined);
      if (!(error instanceof BlenderError)) throw error;
      this.logger.warn(`Torre ${building.code}: geração falhou (${error.code}): ${message}`);
      if (error.code === 'INVALID_PARAMS') throw new BadRequestException(`Parâmetros 3D da torre inválidos: ${message}`);
      if (error.code === 'TIMEOUT') throw new GatewayTimeoutException(message);
      throw new InternalServerErrorException(`Falha ao gerar o modelo no Blender: ${message}`);
    } finally {
      this.running.delete(buildingId);
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Define (ou tira, com assetId null) o GLB que o visualizador público usa para a torre: model3d.glb = { assetId, version }.
   * O asset precisa ser um MODEL_3D do mesmo empreendimento.
   */
  async setViewerModel(context: OrganizationContext, buildingId: string, input: { assetId: string | null; version?: number }) {
    assertCanEdit(context);
    const building = await this.prisma.building.findFirst({ where: { id: buildingId, development: { organizationId: context.organizationId, archivedAt: null } } });
    if (!building) throw new NotFoundException('Torre não encontrada');
    const model3d = { ...((building.model3d && typeof building.model3d === 'object' ? building.model3d : {}) as Record<string, unknown>) };
    if (input.assetId) {
      const asset = await this.prisma.developmentAsset.findFirst({ where: { id: input.assetId, developmentId: building.developmentId, kind: AssetKind.MODEL_3D } });
      if (!asset) throw new BadRequestException('Modelo 3D não encontrado neste empreendimento');
      model3d.glb = { assetId: asset.id, version: input.version ?? null, generatedAt: asset.createdAt.toISOString() };
    } else delete model3d.glb;
    await this.prisma.building.update({ where: { id: buildingId }, data: { model3d: model3d as Prisma.InputJsonValue } });
    return { buildingId, glb: model3d.glb ?? null };
  }

  /** Últimas gerações da torre (para o painel mostrar erro/andamento da anterior). */
  async listTowerJobs(context: OrganizationContext, buildingId: string) {
    const building = await this.prisma.building.findFirst({ where: { id: buildingId, development: { organizationId: context.organizationId } }, select: { developmentId: true } });
    if (!building) throw new NotFoundException('Torre não encontrada');
    const jobs = await this.prisma.generationJob.findMany({ where: { developmentId: building.developmentId, kind: JobKind.MODEL_GENERATION, provider: 'blender', input: { path: '$.buildingId', equals: buildingId } }, orderBy: { createdAt: 'desc' }, take: 10 });
    return jobs.map((j) => ({ id: j.id, status: j.status, error: j.error?.split('\n\n')[0] ?? null, output: j.output, startedAt: j.startedAt, completedAt: j.completedAt }));
  }
}

function blenderWarnings(stderr: string) {
  const lines = stderr.split(/\r?\n/).filter((l) => /warn/i.test(l)).slice(0, 20);
  return lines.length ? lines.join('\n').slice(0, 4000) : null;
}
