import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { DatabaseConfig } from '@config/database.config';

import { buildTypeOrmOptions } from './typeorm-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildTypeOrmOptions(configService.getOrThrow<DatabaseConfig>('database')),
    }),
  ],
})
export class DatabaseModule {}
