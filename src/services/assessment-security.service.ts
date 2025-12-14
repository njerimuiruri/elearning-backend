import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as sanitizeHtml from 'sanitize-html';

/**
 * Comprehensive security service for assessment submissions
 * Handles: input validation, sanitization, rate limiting, CSRF protection, encryption
 */
@Injectable()
export class AssessmentSecurityService {
  private readonly submissionAttempts = new Map<string, number[]>(); // userId -> timestamps
  private readonly maxSubmissionsPerHour = 5;
  private readonly maxSubmissionsPerDay = 20;
  private readonly csrfTokens = new Map<string, { token: string; timestamp: number }>();
  private readonly tokenExpiry = 30 * 60 * 1000; // 30 minutes

  /**
   * Validate and sanitize essay submission
   */
  validateAndSanitizeSubmission(
    essay: string,
    questionType: string,
  ): { valid: boolean; sanitized: string; error?: string } {
    try {
      // Check essay length
      if (!essay || typeof essay !== 'string') {
        return {
          valid: false,
          sanitized: '',
          error: 'Invalid essay format',
        };
      }

      if (essay.trim().length < 10) {
        return {
          valid: false,
          sanitized: '',
          error: 'Essay too short (minimum 10 characters)',
        };
      }

      if (essay.length > 10000) {
        return {
          valid: false,
          sanitized: '',
          error: 'Essay exceeds maximum length (10000 characters)',
        };
      }

      // Sanitize HTML/script tags
      const sanitized = sanitizeHtml(essay, {
        allowedTags: [],
        allowedAttributes: {},
      }).trim();

      // Check for repeated submission (potential spam)
      if (this.isLikelySpam(sanitized)) {
        return {
          valid: false,
          sanitized: '',
          error: 'Submission appears to contain spam',
        };
      }

      return { valid: true, sanitized };
    } catch (error) {
      return {
        valid: false,
        sanitized: '',
        error: 'Error processing submission',
      };
    }
  }

  /**
   * Check rate limiting for submission attempts
   */
  checkRateLimit(
    userId: string,
  ): { allowed: boolean; remainingAttempts?: number; error?: string } {
    try {
      const now = Date.now();
      const userAttempts = this.submissionAttempts.get(userId) || [];

      // Remove attempts older than 24 hours
      const recentAttempts = userAttempts.filter(
        timestamp => now - timestamp < 24 * 60 * 60 * 1000,
      );

      // Check hourly limit
      const lastHourAttempts = recentAttempts.filter(
        timestamp => now - timestamp < 60 * 60 * 1000,
      );

      if (lastHourAttempts.length >= this.maxSubmissionsPerHour) {
        return {
          allowed: false,
          error: `Too many attempts. Maximum ${this.maxSubmissionsPerHour} per hour`,
        };
      }

      // Check daily limit
      if (recentAttempts.length >= this.maxSubmissionsPerDay) {
        return {
          allowed: false,
          error: `Daily limit reached. Maximum ${this.maxSubmissionsPerDay} per day`,
        };
      }

      // Update attempts
      recentAttempts.push(now);
      this.submissionAttempts.set(userId, recentAttempts);

      return {
        allowed: true,
        remainingAttempts:
          this.maxSubmissionsPerHour - lastHourAttempts.length - 1,
      };
    } catch (error) {
      console.error('Rate limit check error:', error);
      return { allowed: false, error: 'System error during validation' };
    }
  }

  /**
   * Generate CSRF token for form submission
   */
  generateCsrfToken(userId: string): string {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      this.csrfTokens.set(userId, {
        token,
        timestamp: Date.now(),
      });

      // Cleanup expired tokens periodically
      this.cleanupExpiredTokens();

      return token;
    } catch (error) {
      console.error('CSRF token generation error:', error);
      throw new Error('Could not generate security token');
    }
  }

  /**
   * Validate CSRF token
   */
  validateCsrfToken(userId: string, token: string): boolean {
    try {
      const stored = this.csrfTokens.get(userId);

      if (!stored) {
        return false;
      }

      // Check expiry
      if (Date.now() - stored.timestamp > this.tokenExpiry) {
        this.csrfTokens.delete(userId);
        return false;
      }

      // Compare tokens (constant-time comparison to prevent timing attacks)
      const isValid = crypto.timingSafeEqual(
        Buffer.from(stored.token),
        Buffer.from(token),
      );

      if (isValid) {
        this.csrfTokens.delete(userId); // One-time use
      }

      return isValid;
    } catch (error) {
      console.error('CSRF token validation error:', error);
      return false;
    }
  }

  /**
   * Encrypt sensitive data for storage
   */
  encryptData(data: string, encryptionKey: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        Buffer.from(encryptionKey, 'hex').slice(0, 32),
        iv,
      );

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Could not encrypt data');
    }
  }

  /**
   * Decrypt sensitive data
   */
  decryptData(encryptedData: string, encryptionKey: string): string {
    try {
      const [ivHex, encrypted] = encryptedData.split(':');
      const iv = Buffer.from(ivHex, 'hex');

      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(encryptionKey, 'hex').slice(0, 32),
        iv,
      );

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Could not decrypt data');
    }
  }

  /**
   * Hash password securely (use bcrypt in real implementation)
   */
  hashValue(value: string): string {
    return crypto
      .createHash('sha256')
      .update(value + process.env.SALT_KEY || 'salt')
      .digest('hex');
  }

  /**
   * Validate submission integrity
   */
  validateSubmissionIntegrity(
    submissionData: any,
    expectedEnrollmentId: string,
    expectedCourseId: string,
  ): { valid: boolean; error?: string } {
    try {
      // Verify enrollment ID
      if (submissionData.enrollmentId !== expectedEnrollmentId) {
        return {
          valid: false,
          error: 'Submission does not match your enrollment',
        };
      }

      // Verify course ID
      if (submissionData.courseId !== expectedCourseId) {
        return {
          valid: false,
          error: 'Submission course mismatch',
        };
      }

      // Verify timestamp is recent (within 1 hour)
      const submissionTime = new Date(submissionData.submittedAt).getTime();
      const now = Date.now();
      if (now - submissionTime > 60 * 60 * 1000) {
        return {
          valid: false,
          error: 'Submission timestamp is invalid',
        };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Invalid submission data' };
    }
  }

  /**
   * Detect potential cheating patterns
   */
  detectCheatingPatterns(
    essay: string,
    studentId: string,
  ): { isSuspicious: boolean; indicators: string[] } {
    const indicators: string[] = [];

    // Check for sudden improvement in writing quality
    // (This would need historical data from student's previous submissions)

    // Check for AI-generated content patterns
    if (this.containsAiPatterns(essay)) {
      indicators.push('Potential AI-generated content detected');
    }

    // Check for copied content markers
    if (this.containsPlagiarismMarkers(essay)) {
      indicators.push('Potential plagiarized content');
    }

    // Check for unnatural language patterns
    if (this.hasUnusualLinguisticPatterns(essay)) {
      indicators.push('Unusual writing patterns detected');
    }

    return {
      isSuspicious: indicators.length > 0,
      indicators,
    };
  }

  /**
   * Private helper: Check for AI-generated patterns
   */
  private containsAiPatterns(text: string): boolean {
    const aiPatterns = [
      /\b(as an AI|as a language model|i don't have|i can't)\b/gi,
      /\b(therefore|furthermore|in conclusion)\b/gi, // Overuse
      /\b(however|additionally|moreover)\b/gi, // Overuse
    ];

    let suspiciousCount = 0;
    const textLength = text.split(/\s+/).length;

    for (const pattern of aiPatterns) {
      const matches = text.match(pattern) || [];
      // If more than 15% of sentences use these patterns, flag
      if (matches.length > textLength / 100 * 2) {
        suspiciousCount++;
      }
    }

    return suspiciousCount > 1;
  }

  /**
   * Private helper: Check for plagiarism markers
   */
  private containsPlagiarismMarkers(text: string): boolean {
    const plagiarismMarkers = [
      /\[([0-9]+)\]/g, // Citation markers
      /\(([A-Z][a-z]+),\s*[0-9]{4}\)/g, // Author, year format
      /^([A-Z][a-z]+ [A-Z][a-z]+),\s*[0-9]{4}/m, // Author format at start
    ];

    for (const marker of plagiarismMarkers) {
      if (marker.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Private helper: Check for unusual linguistic patterns
   */
  private hasUnusualLinguisticPatterns(text: string): boolean {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/);

    // Check sentence length variation
    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    const avgLength =
      sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance =
      sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) /
      sentenceLengths.length;

    // Too consistent sentence length is suspicious
    if (variance < 2) {
      return true;
    }

    // Check for unusual vocabulary patterns
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const uniqueRatio = uniqueWords.size / words.length;

    // Too high unique ratio is suspicious (looks like dictionary dumping)
    if (uniqueRatio > 0.8) {
      return true;
    }

    return false;
  }

  /**
   * Private helper: Check if content is likely spam
   */
  private isLikelySpam(text: string): boolean {
    const spamPatterns = [
      /(.)\1{10,}/g, // Repeated characters
      /\b([a-z])\s+\1\s+\1/gi, // Repeated words
      /(http|https|www|\.com|\.net)/gi, // URLs
    ];

    for (const pattern of spamPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Private helper: Cleanup expired CSRF tokens
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [userId, token] of this.csrfTokens.entries()) {
      if (now - token.timestamp > this.tokenExpiry) {
        this.csrfTokens.delete(userId);
      }
    }
  }
}
