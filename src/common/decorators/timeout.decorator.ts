import { Reflector } from '@nestjs/core';

export const SkipTimeout = Reflector.createDecorator<boolean>({
  transform: (value) => value ?? true,
});

export const TimeoutMs = Reflector.createDecorator<number>();
