---
title: Use Message Queues for Background Jobs
impact: MEDIUM-HIGH
impactDescription: Queues enable reliable background processing
tags: microservices, queues, bullmq, background-jobs, v11
---

## Use Message Queues for Background Jobs

Use `@nestjs/bullmq` for background job processing. Queues decouple long-running tasks from HTTP requests, enable retry logic, and distribute workload across workers. Use them for emails, file processing, notifications, and any task that shouldn't block user requests.

> **NestJS 11 note:** the legacy `@nestjs/bull` package wraps Bull (v3, deprecated). For new projects in NestJS 11 use `@nestjs/bullmq` (BullMQ). The BullMQ processor model is **class-based** — extend `WorkerHost` and implement a single `process(job)` method. The `@Process('name')` decorator from Bull does **not** exist in BullMQ; dispatch by `job.name` inside `process()` instead.

**Incorrect (long-running tasks in HTTP handlers):**

```typescript
// Long-running tasks in HTTP handlers
@Controller('reports')
export class ReportsController {
  @Post()
  async generate(@Body() dto: GenerateReportDto): Promise<Report> {
    // This blocks the request for potentially minutes
    const data = await this.fetchLargeDataset(dto);
    const report = await this.processData(data); // Slow!
    await this.sendEmail(dto.email, report); // Can fail!
    return report; // Client times out
  }
}

// Fire-and-forget without retry
@Injectable()
export class EmailService {
  async sendWelcome(email: string): Promise<void> {
    // If this fails, email is never sent
    await this.mailer.send({ to: email, template: 'welcome' });
    // No retry, no tracking, no visibility
  }
}

// Use setInterval for scheduled tasks
setInterval(async () => {
  await cleanupOldRecords();
}, 60000); // No error handling, memory leaks
```

**Incorrect (legacy Bull `@Process('name')` style — NOT supported in BullMQ):**

```typescript
// ❌ This Bull-only pattern was removed in @nestjs/bullmq
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';

@Processor('audio')
export class AudioConsumer {
  @Process('transcode')
  async transcode(job: Job<unknown>) { /* ... */ }

  @Process('concatenate')
  async concatenate(job: Job<unknown>) { /* ... */ }
}
```

**Correct (use BullMQ `WorkerHost` for background processing):**

```typescript
// Configure BullMQ
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),
    BullModule.registerQueue(
      { name: 'email' },
      { name: 'reports' },
      { name: 'notifications' },
    ),
  ],
})
export class QueueModule {}

// Producer: Add jobs to queue
@Injectable()
export class ReportsService {
  constructor(
    @InjectQueue('reports') private reportsQueue: Queue,
  ) {}

  async requestReport(dto: GenerateReportDto): Promise<{ jobId: string }> {
    // Return immediately, process in background
    const job = await this.reportsQueue.add('generate', dto, {
      priority: dto.urgent ? 1 : 10,
      delay: dto.scheduledFor ? Date.parse(dto.scheduledFor) - Date.now() : 0,
    });

    return { jobId: job.id };
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    const job = await this.reportsQueue.getJob(jobId);
    return {
      status: await job.getState(),
      progress: job.progress,
      result: job.returnvalue,
    };
  }
}

// Consumer: Extend WorkerHost and dispatch by job.name
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('reports')
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  async process(job: Job<any, any, string>): Promise<any> {
    // Single entry point — dispatch on job.name
    switch (job.name) {
      case 'generate':
        return this.generateReport(job);
      case 'export':
        return this.exportReport(job);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  private async generateReport(job: Job<GenerateReportDto>): Promise<Report> {
    this.logger.log(`Processing report job ${job.id}`);

    // Use job.updateProgress() — note: BullMQ uses updateProgress, not progress()
    await job.updateProgress(10);

    const data = await this.fetchData(job.data);
    await job.updateProgress(50);

    const report = await this.processData(data);
    await job.updateProgress(90);

    await this.saveReport(report);
    await job.updateProgress(100);

    return report;
  }

  private async exportReport(job: Job): Promise<void> {
    // ...
  }

  // Listen to worker lifecycle events with @OnWorkerEvent
  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Processing job ${job.id} (${job.name})`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}

// Email queue with retry
@Processor('email')
export class EmailProcessor extends WorkerHost {
  constructor(private readonly mailer: MailerService) {
    super();
  }

  async process(job: Job<SendEmailDto>): Promise<void> {
    const { to, template, data } = job.data;

    try {
      await this.mailer.send({ to, template, context: data });
    } catch (error) {
      // BullMQ retries based on the job's attempts/backoff options
      throw error;
    }
  }
}

// Producer usage
@Injectable()
export class NotificationService {
  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async sendWelcome(user: User): Promise<void> {
    await this.emailQueue.add(
      'send',
      {
        to: user.email,
        template: 'welcome',
        data: { name: user.name },
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }
}

// Scheduled / repeatable jobs
@Injectable()
export class ScheduledJobsService implements OnModuleInit {
  constructor(@InjectQueue('maintenance') private queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Idempotent registration — `jobId` prevents duplicate repeatables
    await this.queue.add(
      'cleanup',
      {},
      {
        repeat: { pattern: '0 0 * * *' }, // BullMQ uses `pattern` (cron) or `every` (ms)
        jobId: 'daily-cleanup',
      },
    );

    await this.queue.add(
      'digest',
      {},
      {
        repeat: { every: 60 * 60 * 1000 },
        jobId: 'hourly-digest',
      },
    );
  }
}

@Processor('maintenance')
export class MaintenanceProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'cleanup':
        return this.cleanup();
      case 'digest':
        return this.sendDigest();
    }
  }

  private async cleanup(): Promise<void> { /* ... */ }
  private async sendDigest(): Promise<void> { /* ... */ }
}

// Queue monitoring with Bull Board
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({ name: 'email', adapter: BullMQAdapter }),
    BullBoardModule.forFeature({ name: 'reports', adapter: BullMQAdapter }),
  ],
})
export class AdminModule {}
```

**Choosing between `@nestjs/bullmq` and `@nestjs/bull`:**

| Concern | `@nestjs/bullmq` (recommended) | `@nestjs/bull` (legacy) |
|---------|--------------------------------|-------------------------|
| Underlying lib | BullMQ (actively maintained) | Bull v3 (in maintenance) |
| Processor API | `extends WorkerHost` + `process()` | `@Process('name')` |
| Events | `@OnWorkerEvent('completed')` | `@OnQueueCompleted()` |
| Job progress | `job.updateProgress(n)` | `job.progress(n)` |
| Repeatable jobs | `repeat: { pattern, every }` | `repeat: { cron, every }` |
| TypeScript | Stricter generics | Looser typings |

Reference: [NestJS Queues](https://docs.nestjs.com/techniques/queues)
