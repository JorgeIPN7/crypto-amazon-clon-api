import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

export const RequestId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<IncomingMessage & { id?: string }>();
    return request.id;
  },
);
