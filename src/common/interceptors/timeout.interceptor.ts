import {
  Injectable,
  RequestTimeoutException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { SSE_METADATA } from '../nest-metadata.constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { catchError, Observable, throwError, TimeoutError, timeout } from 'rxjs';

import { SkipTimeout, TimeoutMs } from '../decorators/timeout.decorator';
import type { AppConfig } from '@config/app.config';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.defaultTimeoutMs = this.configService.getOrThrow<AppConfig>('app').requestTimeoutMs;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const handler = context.getHandler();
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SkipTimeout, [
      handler,
      context.getClass(),
    ]);
    if (skip === true) {
      return next.handle();
    }

    const isSse = Boolean(this.reflector.get<unknown>(SSE_METADATA, handler));
    if (isSse) {
      return next.handle();
    }

    const override = this.reflector.getAllAndOverride<number | undefined>(TimeoutMs, [
      handler,
      context.getClass(),
    ]);
    const ms = typeof override === 'number' && override > 0 ? override : this.defaultTimeoutMs;

    return next.handle().pipe(
      timeout(ms),
      catchError((err: unknown) =>
        err instanceof TimeoutError
          ? throwError(() => new RequestTimeoutException('Request timeout'))
          : throwError(() => err),
      ),
    );
  }
}
