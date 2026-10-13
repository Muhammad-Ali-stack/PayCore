import { Global, Module } from '@nestjs/common';
import { PinoLogger, getLoggerToken } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      inject: [AppConfig, getLoggerToken(RedisService.name)],
      useFactory: (config: AppConfig, logger: PinoLogger): RedisService => {
        if (config.get('REDIS_MODE') === 'memory') {
          // Dev/demo only (env validation forbids it in production). Loaded lazily because
          // ioredis-mock is a devDependency.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const RedisMock = require('ioredis-mock') as new () => RedisService;
          logger.warn('REDIS_MODE=memory: using an in-process Redis mock (single instance, not persistent)');
          return new RedisMock();
        }
        return new RedisService(config, logger);
      },
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
