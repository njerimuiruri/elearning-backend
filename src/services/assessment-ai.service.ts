import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Enrollment } from '../schemas/enrollment.schema';
import { Course } from '../schemas/course.schema';
import { User } from '../schemas/user.schema';
import { Certificate } from '../schemas/certificate.schema';
import { AiEssayEvaluatorService } from './ai-essay-evaluator.service';
import { AssessmentSecurityService } from './assessment-security.service';

/**
 * Enhanced assessment submission with AI evaluation and security
 */
@Injectable()
export class AssessmentAiService {
  constructor(
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(Course.name) private courseModel: Model<Course>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Certificate.name) private certificateModel: Model<Certificate>,
    private aiEvaluator: AiEssayEvaluatorService,
    private securityService: AssessmentSecurityService,
  ) {}

  /**
   * Enhanced submitFinalAssessment with AI evaluation and security
   */
  async submitFinalAssessmentWithAi(
    enrollmentId: string,
    answers: any[],
    csrfToken: string,
    studentId: string,
  ) {
    try {
      // 1. SECURITY CHECKS
      // Validate CSRF token
      if (!this.securityService.validateCsrfToken(studentId, csrfToken)) {
        throw new Error('Invalid security token. Please try again.');
      }

      // Check rate limiting
      const rateCheck = this.securityService.checkRateLimit(studentId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }

      // 2. FETCH DATA
      const enrollment = await this.enrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      // Verify student owns this enrollment
      if (enrollment.studentId.toString() !== studentId) {
        throw new Error('Unauthorized submission attempt');
      }

      const course = await this.courseModel.findById(enrollment.courseId);
      if (!course || !course.finalAssessment) {
        throw new Error('Final assessment not found');
      }

      // 3. VALIDATE SUBMISSION
      const submissionValidation = this.securityService.validateSubmissionIntegrity(
        {
          enrollmentId: enrollmentId,
          courseId: course._id.toString(),
          submittedAt: new Date(),
        },
        enrollmentId,
        course._id.toString(),
      );

      if (!submissionValidation.valid) {
        throw new Error(submissionValidation.error);
      }

      // 4. PROCESS ANSWERS WITH AI
      const questions = course.finalAssessment.questions;
      let closedEndedCorrect = 0;
      let closedEndedTotal = 0;
      let pendingAiReview = 0;
      let earnedPoints = 0;
      let totalPoints = 0;

      enrollment.finalAssessmentAttempts += 1;

      const results = await Promise.all(
        questions.map(async (question, idx) => {
          const userAnswer = answers[idx];
          const maxPts = question.points || 1;
          totalPoints += maxPts;

          // Sanitize answer
          const { valid, sanitized } = this.securityService.validateAndSanitizeSubmission(
            userAnswer || '',
            question.type,
          );

          if (!valid) {
            return this.createInvalidAnswerResult(idx, question, maxPts);
          }

          // Handle essay questions with AI evaluation
          if (question.type === 'essay') {
            return await this.processEssayWithAi(
              idx,
              question,
              sanitized,
              maxPts,
              course.title,
            );
          }

          // Handle closed-ended questions
          const isCorrect = this.checkAnswerCorrect(question, sanitized);
          if (isCorrect) {
            closedEndedCorrect++;
            earnedPoints += maxPts;
          }
          closedEndedTotal++;

          return {
            questionIndex: idx,
            questionText: question.text,
            questionType: question.type,
            studentAnswer: sanitized,
            correctAnswer: question.correctAnswer,
            isCorrect,
            explanation: question.explanation,
            pointsEarned: isCorrect ? maxPts : 0,
            maxPoints: maxPts,
            instructorFeedback: null,
            gradedAt: isCorrect ? new Date() : null,
            requiresManualGrading: false,
            aiScore: undefined,
            aiConfidence: undefined,
            aiGradingStatus: undefined,
            aiFeedback: undefined,
            aiIdentifiedStrengths: undefined,
            aiIdentifiedWeaknesses: undefined,
            aiKeyConceptsFound: undefined,
            aiSemanticMatch: undefined,
            aiContentRelevance: undefined,
            aiPlagiarismRisk: undefined,
            aiCheatingIndicators: undefined,
            aiEvaluatedAt: undefined,
          };
        }),
      );

      // Count pending AI reviews
      pendingAiReview = results.filter(r => r.aiGradingStatus === 'requires_review').length;

      // 5. CALCULATE SCORE
      const scorePercentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
      enrollment.finalAssessmentScore = scorePercentage;
      enrollment.finalAssessmentResults = results;
      enrollment.pendingManualGradingCount = pendingAiReview;

      // 6. DETERMINE PASS/FAIL
      const allQuestionsGraded =
        results.every(r => r.aiGradingStatus !== 'requires_review');
      const passed =
        allQuestionsGraded &&
        scorePercentage >= (course.finalAssessment.passingScore || 70);

      enrollment.finalAssessmentPassed = passed;

      if (passed) {
        enrollment.isCompleted = true;
        enrollment.completedAt = new Date();
        enrollment.certificateEarned = true;

        // Auto-generate certificate
        const student = await this.userModel.findById(enrollment.studentId);
        const instructor = (course as any)?.instructorId;

        const certificate = await this.certificateModel.create({
          studentId: enrollment.studentId,
          courseId: course._id,
          courseName: course.title,
          studentName: `${student?.firstName} ${student?.lastName}`,
          instructorName: `${instructor?.firstName} ${instructor?.lastName}`,
          issuedDate: new Date(),
          completionDate: new Date(),
        });

        enrollment.certificateId = certificate._id as any;
        enrollment.certificateUrl = `/api/certificates/${certificate._id}`;
        enrollment.certificateIssuedAt = new Date();
      }

      await enrollment.save();

      // 7. RETURN RESPONSE
      return {
        success: true,
        passed,
        score: scorePercentage,
        results,
        attemptsUsed: enrollment.finalAssessmentAttempts,
        attemptsRemaining: 3 - enrollment.finalAssessmentAttempts,
        passingScore: course.finalAssessment.passingScore || 70,
        canRetry: !passed && enrollment.finalAssessmentAttempts < 3,
        mustRestartCourse: !passed && enrollment.finalAssessmentAttempts >= 3,
        certificateEarned: passed,
        certificateUrl: passed ? enrollment.certificateUrl : null,
        aiEvaluationCount: results.filter(r => r.aiScore !== undefined).length,
        pendingInstructorReview: pendingAiReview,
        requiresInstructorGrading: pendingAiReview > 0,
      };
    } catch (error) {
      console.error('Assessment submission error:', error);
      return {
        success: false,
        error: error.message || 'Error processing assessment',
      };
    }
  }

  /**
   * Process essay question with AI evaluation
   */
  private async processEssayWithAi(
    idx: number,
    question: any,
    studentAnswer: string,
    maxPts: number,
    courseTitle: string,
  ) {
    try {
      // Build rubric from question metadata
      const rubric = question.rubric || [
        {
          criterion: 'Overall Quality',
          weight: 1,
          expectedKeywords: question.expectedKeywords || [],
          description: question.text,
        },
      ];

      // Get AI evaluation
      const aiEvaluation = await this.aiEvaluator.evaluateEssay(
        studentAnswer,
        question.correctAnswer || '',
        rubric,
        courseTitle,
      );

      // Check for cheating
      const cheatingCheck = this.securityService.detectCheatingPatterns(
        studentAnswer,
        'anonymous', // anonymized for security
      );

      // Determine if AI can auto-grade or needs manual review
      const isCorrect =
        aiEvaluation.status === 'auto_passed' &&
        aiEvaluation.score >= 70;
      const pointsEarned =
        isCorrect || aiEvaluation.status === 'auto_passed'
          ? maxPts
          : 0;

      return {
        questionIndex: idx,
        questionText: question.text,
        questionType: 'essay',
        studentAnswer,
        correctAnswer: undefined,
        isCorrect,
        explanation: question.explanation,
        pointsEarned,
        maxPoints: maxPts,
        instructorFeedback: null,
        gradedAt:
          aiEvaluation.status !== 'requires_review'
            ? new Date()
            : null,
        requiresManualGrading:
          aiEvaluation.status === 'requires_review',
        // AI evaluation fields
        aiScore: aiEvaluation.score,
        aiConfidence: aiEvaluation.confidence,
        aiGradingStatus: aiEvaluation.status,
        aiFeedback: aiEvaluation.feedback,
        aiIdentifiedStrengths: aiEvaluation.strengths,
        aiIdentifiedWeaknesses: aiEvaluation.areasForImprovement,
        aiKeyConceptsFound: aiEvaluation.keyConceptsFound,
        aiSemanticMatch: aiEvaluation.semanticMatch,
        aiContentRelevance: aiEvaluation.contentRelevance,
        aiPlagiarismRisk: aiEvaluation.plagarismRisk,
        aiCheatingIndicators: cheatingCheck.indicators,
        aiEvaluatedAt: new Date(),
      };
    } catch (error) {
      console.error('AI evaluation error for question', idx, error);
      // Fallback to manual review if AI fails
      return {
        questionIndex: idx,
        questionText: question.text,
        questionType: 'essay',
        studentAnswer,
        correctAnswer: undefined,
        isCorrect: false,
        explanation: question.explanation,
        pointsEarned: 0,
        maxPoints: maxPts,
        instructorFeedback: null,
        gradedAt: null,
        requiresManualGrading: true,
        aiScore: 0,
        aiConfidence: 0,
        aiGradingStatus: 'requires_review',
        aiFeedback: 'AI evaluation failed. Awaiting instructor review.',
        aiIdentifiedStrengths: [],
        aiIdentifiedWeaknesses: [],
        aiKeyConceptsFound: [],
        aiSemanticMatch: 0,
        aiContentRelevance: 0,
        aiPlagiarismRisk: 0,
        aiCheatingIndicators: [],
        aiEvaluatedAt: null,
      };
    }
  }

  /**
   * Check if answer is correct for closed-ended questions
   */
  private checkAnswerCorrect(question: any, userAnswer: string): boolean {
    const normalize = (val: any) =>
      val === undefined || val === null
        ? ''
        : String(val).trim().toLowerCase();

    const normCorrect = normalize(question.correctAnswer);
    const normUser = normalize(userAnswer);

    if (normCorrect === normUser) return true;

    // Handle option index matching
    const hasOptions =
      Array.isArray(question.options) && question.options.length > 0;
    const parsedIndex = (() => {
      if (typeof userAnswer === 'number' && Number.isInteger(userAnswer))
        return userAnswer;
      if (
        typeof userAnswer === 'string' &&
        userAnswer.trim() !== '' &&
        !isNaN(Number(userAnswer))
      ) {
        return parseInt(userAnswer, 10);
      }
      return null;
    })();

    if (
      hasOptions &&
      parsedIndex !== null &&
      parsedIndex >= 0 &&
      parsedIndex < question.options.length
    ) {
      const optionValue = normalize(question.options[parsedIndex]);
      if (optionValue === normCorrect) return true;
      if (normalize(parsedIndex) === normCorrect) return true;
    }

    if (hasOptions) {
      const matchedIdx = question.options.findIndex((opt: any) =>
        normalize(opt) === normUser ? true : false,
      );
      if (matchedIdx >= 0) {
        if (normalize(matchedIdx) === normCorrect) return true;
        if (normalize(question.options[matchedIdx]) === normCorrect)
          return true;
      }
    }

    return false;
  }

  /**
   * Create invalid answer result for sanitization failures
   */
  private createInvalidAnswerResult(idx: number, question: any, maxPts: number) {
    return {
      questionIndex: idx,
      questionText: question.text,
      questionType: question.type,
      studentAnswer: '',
      correctAnswer: undefined,
      isCorrect: false,
      explanation: question.explanation,
      pointsEarned: 0,
      maxPoints: maxPts,
      instructorFeedback: 'Invalid submission',
      gradedAt: new Date(),
      requiresManualGrading: false,
      aiScore: 0,
      aiConfidence: 0,
      aiGradingStatus: undefined,
      aiFeedback: 'Invalid answer format',
      aiIdentifiedStrengths: [],
      aiIdentifiedWeaknesses: ['Invalid submission format'],
      aiKeyConceptsFound: [],
      aiSemanticMatch: 0,
      aiContentRelevance: 0,
      aiPlagiarismRisk: 0,
      aiCheatingIndicators: [],
      aiEvaluatedAt: null,
    };
  }
}
