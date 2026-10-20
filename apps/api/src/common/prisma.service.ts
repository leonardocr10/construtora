import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const maxAttempts = Number(process.env.DATABASE_CONNECT_RETRIES ?? 5);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida no .env');
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        this.logger.log('Conectado ao MySQL');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= maxAttempts) throw new Error(`Não foi possível conectar ao MySQL após ${attempt} tentativas: ${message}`);
        this.logger.warn(`Falha ao conectar ao MySQL (tentativa ${attempt}/${maxAttempts}): ${message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  async onModuleDestroy() { await this.$disconnect(); }

  async ping() {
    const started = Date.now();
    const [row] = await this.$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`;
    const [migrations] = await this.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    return { status: 'ok', mysqlVersion: row.version, appliedMigrations: Number(migrations.total), latencyMs: Date.now() - started };
  }
}
