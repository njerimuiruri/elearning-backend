import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_INVITATIONS_QUEUE } from './email-queue.constants';

export interface FellowInvitationJobData {
  userId: string;
  email: string;
  firstName: string;
  temporaryPassword: string;
  track?: string;
  cohort?: string;
  setupToken: string;
}

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    @InjectQueue(EMAIL_INVITATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Adds a fellow invitation email job to the queue.
   * Returns immediately — the worker processes it in the background.
   */
  async enqueueFellowInvitation(data: FellowInvitationJobData): Promise<void> {
    await this.queue.add('send-fellow-invitation', data, {
      // Unique job per email prevents duplicate sends on re-enqueue
      jobId: `fellow-invite:${data.userId}`,
    });
    this.logger.log(`Queued invitation for ${data.email}`);
  }

  /**
   * Bulk-enqueues multiple invitation jobs at once.
   * BulkMQ's addBulk is a single Redis round-trip for all jobs.
   */
  async enqueueBulkFellowInvitations(
    jobs: FellowInvitationJobData[],
  ): Promise<void> {
    if (jobs.length === 0) return;

    const bulkJobs = jobs.map((data) => ({
      name: 'send-fellow-invitation',
      data,
      opts: {
        jobId: `fellow-invite:${data.userId}`,
      },
    }));

    await this.queue.addBulk(bulkJobs);
    this.logger.log(`Queued ${jobs.length} fellow invitation emails`);
  }

  /** Returns current queue counts — useful for a status endpoint. */
  async getQueueStatus() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }
}
