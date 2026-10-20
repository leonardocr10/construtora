import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Converte erros do Prisma/MySQL em respostas HTTP compreensíveis sem expor detalhes internos.
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientInitializationError, Prisma.PrismaClientRustPanicError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: Error, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro inesperado no banco de dados';
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') { status = HttpStatus.CONFLICT; message = `Registro duplicado: ${String((error.meta?.target as string[] | string | undefined) ?? 'campo único')}`; }
      else if (error.code === 'P2003') { status = HttpStatus.CONFLICT; message = 'Operação viola um relacionamento existente'; }
      else if (error.code === 'P2025') { status = HttpStatus.NOT_FOUND; message = 'Registro não encontrado'; }
      else if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code)) { status = HttpStatus.SERVICE_UNAVAILABLE; message = 'Banco de dados indisponível'; }
    } else if (error instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE; message = 'Banco de dados indisponível';
    }
    if (status >= 500) this.logger.error(error.message);
    response.status(status).json({ statusCode: status, message });
  }
}
