import { Reflector } from '@nestjs/core';

export const SkipTransform = Reflector.createDecorator<boolean>({
  transform: (value) => value ?? true,
});
