import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AssessmentSecurityService } from '../services/assessment-security.service';

/**
 * CSRF Token Middleware
 * Validates CSRF tokens on assessment endpoints
 */
@Injectable()
export class CsrfTokenMiddleware implements NestMiddleware {
  constructor(private securityService: AssessmentSecurityService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const token = req.headers['x-csrf-token'] as string;
    const userId = (req as any).user?.userId || (req as any).userId;

    if (!token || !userId) {
      return res.status(403).json({
        error: 'CSRF token missing',
      });
    }

    if (!this.securityService.validateCsrfToken(userId, token)) {
      return res.status(403).json({
        error: 'Invalid CSRF token',
      });
    }

    next();
  }
}

/**
 * Rate Limiting Middleware
 * Prevents brute force submission attempts
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private securityService: AssessmentSecurityService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.userId || (req as any).userId;

    if (!userId) {
      return res.status(401).json({
        error: 'User not authenticated',
      });
    }

    const rateCheck = this.securityService.checkRateLimit(userId);

    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', '3600'); // 1 hour in seconds
      return res.status(429).json({
        error: rateCheck.error,
        remainingAttempts: rateCheck.remainingAttempts,
        retryAfter: 3600,
      });
    }

    if (rateCheck.remainingAttempts !== undefined) {
      res.setHeader('X-RateLimit-Remaining', rateCheck.remainingAttempts);
    }
    next();
  }
}

/**
 * Assessment Audit Logging Middleware
 * Logs all assessment submission attempts for security audit trail
 */
@Injectable()
export class AssessmentAuditMiddleware implements NestMiddleware {
  constructor() {}

  use(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.userId;
    const enrollmentId = req.body?.enrollmentId;
    const timestamp = new Date().toISOString();

    const originalSend = res.send;
    const originalJson = res.json;

    let responseBody: any;

    // Capture response
    res.json = function (body: any) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    res.on('finish', () => {
      const logEntry = {
        timestamp,
        userId,
        enrollmentId,
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        success: res.statusCode === 200,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      };

      if (res.statusCode >= 400) {
        console.warn('[ASSESSMENT_AUDIT]', JSON.stringify(logEntry));
      } else {
        console.log('[ASSESSMENT_AUDIT]', JSON.stringify(logEntry));
      }
    });

    next();
  }
}
