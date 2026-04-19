import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { EMAIL_INVITATIONS_QUEUE } from './email-queue.constants';
import { FellowInvitationJobData } from './email-queue.service';
import { EmailService } from '../common/services/email.service';
import { User } from '../schemas/user.schema';

@Processor(EMAIL_INVITATIONS_QUEUE, {
  /**
   * Rate limiter: at most 10 emails per 60 seconds.
   * BullMQ pauses this worker automatically when the limit is hit
   * and resumes once the window resets — no manual sleep needed.
   */
  limiter: { max: 10, duration: 60_000 },
  /**
   * Process one email at a time so the rate limiter is precise.
   * Increase concurrency only if your SMTP provider explicitly allows it.
   */
  concurrency: 1,
})
export class EmailQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {
    super();
  }

  async process(job: Job<FellowInvitationJobData>): Promise<void> {
    const { userId, email, firstName, temporaryPassword, track, cohort, setupToken } =
      job.data;

    this.logger.log(
      `Processing job ${job.id} — sending invitation to ${email} (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.emailService.sendFellowInvitationEmail(
      email,
      firstName,
      temporaryPassword,
      { track, cohort, setupToken },
    );

    if (!result?.success) {
      // Throwing causes BullMQ to mark the job as failed and retry with backoff
      throw new Error(
        result?.message ?? 'Email service returned failure without a message',
      );
    }

    // Mark the user record so the admin can see delivery status
    await this.userModel.findByIdAndUpdate(userId, {
      invitationEmailSent: true,
      invitationEmailSentAt: new Date(),
    });

    this.logger.log(`Invitation delivered to ${email}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<FellowInvitationJobData>, error: Error) {
    const remaining = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
    if (remaining > 0) {
      this.logger.warn(
        `Job ${job.id} failed for ${job.data.email}: ${error.message} — ${remaining} retries left`,
      );
    } else {
      this.logger.error(
        `Job ${job.id} permanently failed for ${job.data.email} after all retries: ${error.message}`,
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} completed successfully`);
  }
}
