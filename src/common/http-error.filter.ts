import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

/** Respuestas de error con la forma `{ error: string }` que consume el front. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno.';
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : String((body as { message?: unknown }).message ?? exception.message);
      if (status === HttpStatus.NOT_FOUND) message = 'No se encontró el recurso.';
    }
    res.status(status).set('Cache-Control', 'no-store').json({ error: message });
  }
}
