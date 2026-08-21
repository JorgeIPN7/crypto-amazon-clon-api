import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import type { AppConfig } from '@config/app.config';
import type { LogConfig } from '@config/log.config';

import { buildPinoHttpOptions } from './pino-options';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: buildPinoHttpOptions(
          configService.getOrThrow<LogConfig>('log'),
          configService.getOrThrow<AppConfig>('app'),
        ),
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
