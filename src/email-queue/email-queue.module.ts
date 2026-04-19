import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailQueueService } from './email-queue.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { EmailService } from '../common/services/email.service';
import { User, UserSchema } from '../schemas/user.schema';
import { EMAIL_INVITATIONS_QUEUE } from './email-queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: EMAIL_INVITATIONS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5_000, // 5s → 25s → 125s
        },
        removeOnComplete: 100, // keep last 100 completed jobs in Redis
        removeOnFail: 200,    // keep last 200 failed jobs for inspection
      },
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [EmailQueueService, EmailQueueProcessor, EmailService],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}
