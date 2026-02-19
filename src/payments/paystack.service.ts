import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number;
    message: string;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: any;
    fees: number;
    customer: {
      id: number;
      email: string;
      customer_code: string;
    };
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string | null;
    };
  };
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly paystackApi: AxiosInstance;
  private readonly secretKey: string;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (!secretKey) {
      throw new Error('PAYSTACK_SECRET_KEY is not configured');
    }

    this.secretKey = secretKey;

    this.paystackApi = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Initialize a Paystack transaction
   * @param email - Customer email
   * @param amount - Amount in Naira (will be converted to kobo)
   * @param reference - Unique transaction reference
   * @param metadata - Additional data to attach
   * @returns Paystack initialization response with authorization URL
   */
  async initializeTransaction(
    email: string,
    amount: number,
    reference: string,
    metadata: Record<string, any> = {},
    callbackUrl?: string,
    channels?: string[],
  ): Promise<PaystackInitializeResponse> {
    try {
      const body: Record<string, any> = {
        email,
        amount: Math.round(amount * 100), // Convert to kobo (smallest currency unit)
        reference,
        metadata,
        callback_url: callbackUrl,
        currency: 'NGN', // Nigerian Naira
      };
      if (channels && channels.length > 0) {
        body.channels = channels;
      }
      const response = await this.paystackApi.post('/transaction/initialize', body);

      this.logger.log(`Initialized transaction ${reference} for ${email}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to initialize transaction: ${error.message}`);
      throw new BadRequestException(
        `Failed to initialize payment: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Verify a Paystack transaction
   * @param reference - Transaction reference to verify
   * @returns Verification response with transaction details
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    try {
      const response = await this.paystackApi.get(`/transaction/verify/${reference}`);

      this.logger.log(`Verified transaction ${reference}: ${response.data.data.status}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to verify transaction ${reference}: ${error.message}`);
      throw new BadRequestException(
        `Failed to verify payment: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Fetch transaction details
   * @param transactionId - Paystack transaction ID
   */
  async fetchTransaction(transactionId: number): Promise<any> {
    try {
      const response = await this.paystackApi.get(`/transaction/${transactionId}`);
      return response.data;
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch transaction: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Generate a unique transaction reference
   * @param prefix - Optional prefix for the reference
   */
  generateReference(prefix: string = 'PAY'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${prefix}-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Verify webhook signature
   * Used to validate that webhook requests actually come from Paystack
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(payload)
      .digest('hex');

    return hash === signature;
  }

  /**
   * List transactions (for admin/reporting)
   */
  async listTransactions(params?: {
    perPage?: number;
    page?: number;
    status?: 'success' | 'failed' | 'abandoned';
    from?: string;
    to?: string;
  }): Promise<any> {
    try {
      const response = await this.paystackApi.get('/transaction', { params });
      return response.data;
    } catch (error) {
      throw new BadRequestException(
        `Failed to list transactions: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Initiate refund (Paystack doesn't have direct refund API, requires manual process)
   * This method documents the refund request
   */
  async requestRefund(transactionReference: string, reason: string): Promise<any> {
    // Paystack requires manual refund requests through their dashboard or support
    // This method should log the refund request and notify admins
    this.logger.warn(
      `Refund requested for transaction ${transactionReference}: ${reason}`,
    );

    // In production, you would:
    // 1. Create a refund request record in your database
    // 2. Send notification to admin
    // 3. Admin processes refund through Paystack dashboard

    return {
      message: 'Refund request logged. Admin will process through Paystack dashboard.',
      reference: transactionReference,
      reason,
    };
  }

  /**
   * Convert amount from Naira to Kobo
   */
  toKobo(amountInNaira: number): number {
    return Math.round(amountInNaira * 100);
  }

  /**
   * Convert amount from Kobo to Naira
   */
  fromKobo(amountInKobo: number): number {
    return amountInKobo / 100;
  }
}
