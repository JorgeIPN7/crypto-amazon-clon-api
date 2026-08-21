import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { SSE_METADATA } from '../nest-metadata.constants';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { map, type Observable } from 'rxjs';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { SkipTransform } from '../decorators/skip-transform.decorator';

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  request: {
    timestamp: string;
    path: string;
    requestId: string;
  };
};

const isRedirectDescriptor = (value: unknown): value is { url: string; statusCode: number } => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > 2) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.url === 'string' && typeof v.statusCode === 'number';
};

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T> | T> {
  constructor(
    private readonly reflector: Reflector,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly cls: ClsService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | T> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SkipTransform, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return next.handle();
    }

    const isSse = Boolean(this.reflector.get<unknown>(SSE_METADATA, context.getHandler()));
    if (isSse) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<IncomingMessage & { id?: string; url?: string }>();
    const response = http.getResponse<ServerResponse>();
    const httpAdapter = this.httpAdapterHost.httpAdapter;

    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) {
          return data;
        }
        if (data instanceof StreamableFile) {
          return data;
        }
        if (Buffer.isBuffer(data)) {
          return data;
        }
        if (isRedirectDescriptor(data)) {
          return data;
        }

        const contentType = response.getHeader?.('content-type');
        if (typeof contentType === 'string' && !contentType.includes('application/json')) {
          return data;
        }

        const path: string =
          (httpAdapter.getRequestUrl(request) as string | undefined) ?? request.url ?? '';
        const requestId: string = this.cls.getId() ?? request.id ?? '';

        return {
          success: true as const,
          data,
          request: {
            timestamp: new Date().toISOString(),
            path,
            requestId,
          },
        };
      }),
    );
  }
}
