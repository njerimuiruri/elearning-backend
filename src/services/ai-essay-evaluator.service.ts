import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

interface EssayEvaluationResult {
  score: number; // 0-100
  confidence: number; // 0-100 (how confident the AI is)
  feedback: string;
  strengths: string[];
  areasForImprovement: string[];
  keyConceptsFound: string[];
  semanticMatch: number; // 0-100
  contentRelevance: number; // 0-100
  requiresManualReview: boolean; // if confidence is medium
  plagarismRisk: number; // 0-100
  status: 'auto_passed' | 'auto_failed' | 'requires_review'; // based on confidence
}

interface RubricCriteria {
  criterion: string;
  weight: number; // 0-1
  expectedKeywords: string[];
  minWords?: number;
  maxWords?: number;
  description: string;
}

@Injectable()
export class AiEssayEvaluatorService {
  private openaiApiKey = process.env.OPENAI_API_KEY;
  private huggingFaceToken = process.env.HUGGINGFACE_API_TOKEN;
  private openaiEndpoint = 'https://api.openai.com/v1';

  constructor() {
    if (!this.openaiApiKey && !this.huggingFaceToken) {
      console.warn('No AI API credentials found. Essay evaluation will be limited.');
    }
  }

  /**
   * Evaluate an essay using AI-powered NLP analysis
   * Combines semantic analysis, keyword matching, and plagiarism detection
   */
  async evaluateEssay(
    studentEssay: string,
    expectedAnswer: string,
    rubric: RubricCriteria[],
    courseTitle?: string,
  ): Promise<EssayEvaluationResult> {
    try {
      // Input validation and sanitization
      if (!studentEssay || studentEssay.trim().length < 10) {
        return this.createLowConfidenceResult('Essay too short to evaluate', 20);
      }

      if (studentEssay.length > 10000) {
        return this.createLowConfidenceResult('Essay exceeds maximum length', 25);
      }

      // Sanitize input to prevent injection attacks
      const sanitizedEssay = this.sanitizeInput(studentEssay);
      const sanitizedExpected = this.sanitizeInput(expectedAnswer);

      // Run parallel evaluations
      const [semanticScore, keywordMatch, plagarismCheck, contentRelevance] =
        await Promise.all([
          this.evaluateSemanticSimilarity(sanitizedEssay, sanitizedExpected),
          this.evaluateKeywordMatching(sanitizedEssay, rubric),
          this.checkPlagiarismRisk(sanitizedEssay),
          this.evaluateContentRelevance(sanitizedEssay, courseTitle),
        ]);

      // Calculate weighted score
      const weights = {
        semantic: 0.4,
        keywords: 0.3,
        relevance: 0.3,
      };

      const finalScore =
        semanticScore * weights.semantic +
        keywordMatch * weights.keywords +
        contentRelevance * weights.relevance;

      // Determine confidence level based on consistency
      const confidence = this.calculateConfidence(
        semanticScore,
        keywordMatch,
        contentRelevance,
        plagarismCheck,
      );

      // Determine auto-grading status
      const status = this.determineGradingStatus(finalScore, confidence);

      // Extract feedback components
      const strengths = this.extractStrengths(
        semanticScore,
        keywordMatch,
        contentRelevance,
      );
      const improvements = this.extractImprovements(
        semanticScore,
        keywordMatch,
        contentRelevance,
      );

      // Extract key concepts
      const concepts = await this.extractKeyConcepts(sanitizedEssay, rubric);

      const result: EssayEvaluationResult = {
        score: Math.round(finalScore),
        confidence: Math.round(confidence),
        feedback: this.generateFeedback(
          finalScore,
          confidence,
          strengths,
          improvements,
        ),
        strengths,
        areasForImprovement: improvements,
        keyConceptsFound: concepts,
        semanticMatch: Math.round(semanticScore),
        contentRelevance: Math.round(contentRelevance),
        requiresManualReview: confidence < 75 && confidence >= 55,
        plagarismRisk: Math.round(plagarismCheck),
        status,
      };

      return result;
    } catch (error) {
      console.error('Essay evaluation error:', error);
      // Return safe default on AI service failure
      return this.createLowConfidenceResult(
        'System unable to fully evaluate essay. Please await instructor review.',
        30,
      );
    }
  }

  /**
   * Evaluate semantic similarity between student essay and expected answer
   * Uses OpenAI embeddings or fallback string similarity
   */
  private async evaluateSemanticSimilarity(
    studentText: string,
    expectedText: string,
  ): Promise<number> {
    try {
      if (this.openaiApiKey) {
        return await this.getEmbeddingSimilarity(studentText, expectedText);
      } else {
        // Fallback: string-based similarity
        return this.calculateStringSimilarity(studentText, expectedText);
      }
    } catch (error) {
      console.error('Semantic similarity evaluation failed:', error);
      return this.calculateStringSimilarity(studentText, expectedText);
    }
  }

  /**
   * Get embedding-based similarity using OpenAI API
   */
  private async getEmbeddingSimilarity(
    text1: string,
    text2: string,
  ): Promise<number> {
    try {
      const [emb1, emb2] = await Promise.all([
        this.getEmbedding(text1),
        this.getEmbedding(text2),
      ]);

      if (!emb1 || !emb2) {
        return this.calculateStringSimilarity(text1, text2);
      }

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(emb1, emb2);
      return Math.min(100, Math.max(0, similarity * 100));
    } catch (error) {
      console.error('Embedding API error:', error);
      return this.calculateStringSimilarity(text1, text2);
    }
  }

  /**
   * Get embedding for text using OpenAI API
   */
  private async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        `${this.openaiEndpoint}/embeddings`,
        {
          input: text,
          model: 'text-embedding-3-small',
        },
        {
          headers: {
            Authorization: `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        },
      );

      return response.data.data[0].embedding;
    } catch (error) {
      console.error('Embedding request failed:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = vec1.reduce((sum, a, i) => sum + a * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, a) => sum + a * a, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, a) => sum + a * a, 0));

    if (magnitude1 === 0 || magnitude2 === 0) return 0;
    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Fallback: simple string similarity using Levenshtein-like approach
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    // Extract key terms (words > 4 chars)
    const getKeyTerms = (s: string) =>
      s.match(/\b\w{4,}\b/g) || [];
    const terms1 = new Set(getKeyTerms(s1));
    const terms2 = new Set(getKeyTerms(s2));

    // Calculate Jaccard similarity
    const intersection = new Set(
      [...terms1].filter(x => terms2.has(x)),
    );
    const union = new Set([...terms1, ...terms2]);

    if (union.size === 0) return 50;
    return (intersection.size / union.size) * 100;
  }

  /**
   * Evaluate how well student covered required keywords/concepts
   */
  private async evaluateKeywordMatching(
    essay: string,
    rubric: RubricCriteria[],
  ): Promise<number> {
    const essayLower = essay.toLowerCase();
    let totalWeight = 0;
    let matchedWeight = 0;

    for (const criterion of rubric) {
      totalWeight += criterion.weight;

      const keywordsFound = criterion.expectedKeywords.filter(keyword =>
        essayLower.includes(keyword.toLowerCase()),
      );

      const matchRatio = keywordsFound.length / criterion.expectedKeywords.length;
      matchedWeight += matchRatio * criterion.weight;
    }

    return totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 50;
  }

  /**
   * Check for plagiarism risk using patterns and content analysis
   */
  private async checkPlagiarismRisk(essay: string): Promise<number> {
    // Check for common plagiarism patterns
    const patterns = {
      quotesWithoutAttribution: /["'][^"']{50,}["']/g,
      suspiciousPhrasing: /\b(according to wikipedia|as stated in|the following text)\b/gi,
      aiGeneratedPatterns:
        /\b(therefore|furthermore|in conclusion|in summary)\b/gi,
    };

    let riskScore = 0;

    // Check quote patterns
    const quotes = essay.match(patterns.quotesWithoutAttribution) || [];
    riskScore += Math.min(30, quotes.length * 5);

    // Check suspicious phrasing
    const suspicious =
      essay.match(patterns.suspiciousPhrasing) || [];
    riskScore += Math.min(20, suspicious.length * 3);

    // Check for AI-like patterns (but not too strict)
    const aiPatterns = essay.match(patterns.aiGeneratedPatterns) || [];
    if (aiPatterns.length > essay.split('.').length * 0.5) {
      riskScore += 15;
    }

    return Math.min(100, riskScore);
  }

  /**
   * Evaluate content relevance to course/question
   */
  private async evaluateContentRelevance(
    essay: string,
    courseTitle?: string,
  ): Promise<number> {
    const essayLength = essay.trim().split(/\s+/).length;

    // Minimum length check
    if (essayLength < 50) return 40;
    if (essayLength < 100) return 60;
    if (essayLength > 2000) return 80; // Very long essays lose some points

    // Check for meaningful content (not just filler)
    const sentences = essay.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength =
      essay.length / Math.max(1, sentences.length);

    // Good essays have varied sentence length
    let relevanceScore = 70;

    if (avgSentenceLength < 20 || avgSentenceLength > 150) {
      relevanceScore -= 10;
    }

    // Bonus for course-specific keywords
    if (courseTitle) {
      const courseKeywords = courseTitle.toLowerCase().split(/\s+/);
      const matchedKeywords = courseKeywords.filter(kw =>
        essay.toLowerCase().includes(kw),
      );
      relevanceScore +=
        Math.min(15, matchedKeywords.length * 5);
    }

    return Math.min(100, relevanceScore);
  }

  /**
   * Extract key concepts mentioned in the essay
   */
  private async extractKeyConcepts(
    essay: string,
    rubric: RubricCriteria[],
  ): Promise<string[]> {
    const essayLower = essay.toLowerCase();
    const concepts: string[] = [];

    for (const criterion of rubric) {
      for (const keyword of criterion.expectedKeywords) {
        if (essayLower.includes(keyword.toLowerCase())) {
          concepts.push(keyword);
        }
      }
    }

    // Remove duplicates
    return [...new Set(concepts)];
  }

  /**
   * Calculate overall confidence in the evaluation
   */
  private calculateConfidence(
    semantic: number,
    keywords: number,
    relevance: number,
    plagiarism: number,
  ): number {
    // If plagiarism risk is high, lower confidence
    let confidence = (semantic + keywords + relevance) / 3;

    if (plagiarism > 50) {
      confidence *= 0.7; // Reduce confidence if plagiarism suspected
    }

    // Boost confidence if all metrics are consistent
    const consistency =
      100 -
      (Math.abs(semantic - keywords) +
        Math.abs(keywords - relevance) +
        Math.abs(relevance - semantic)) /
        3;
    confidence = (confidence + consistency) / 2;

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Determine if essay should be auto-graded or flagged for review
   */
  private determineGradingStatus(
    score: number,
    confidence: number,
  ): 'auto_passed' | 'auto_failed' | 'requires_review' {
    if (confidence >= 85) {
      return score >= 70 ? 'auto_passed' : 'auto_failed';
    }
    return 'requires_review';
  }

  /**
   * Extract strength points from evaluation metrics
   */
  private extractStrengths(
    semantic: number,
    keywords: number,
    relevance: number,
  ): string[] {
    const strengths: string[] = [];

    if (semantic >= 75) {
      strengths.push(
        'Strong semantic alignment with expected concepts',
      );
    }
    if (keywords >= 80) {
      strengths.push('Covered most required concepts and keywords');
    }
    if (relevance >= 75) {
      strengths.push('Well-structured and relevant response');
    }
    if (semantic >= 65 && keywords >= 65) {
      strengths.push('Demonstrates understanding of core material');
    }

    return strengths.length > 0
      ? strengths
      : ['Response submitted and recorded'];
  }

  /**
   * Extract improvement areas from evaluation metrics
   */
  private extractImprovements(
    semantic: number,
    keywords: number,
    relevance: number,
  ): string[] {
    const improvements: string[] = [];

    if (semantic < 70) {
      improvements.push(
        'Consider covering more aspects of the expected answer',
      );
    }
    if (keywords < 70) {
      improvements.push('Include more key concepts and terminology');
    }
    if (relevance < 70) {
      improvements.push('Focus more directly on the question asked');
    }
    if (semantic < 60 || keywords < 60) {
      improvements.push(
        'Review course materials and provided examples',
      );
    }

    return improvements;
  }

  /**
   * Generate human-readable feedback
   */
  private generateFeedback(
    score: number,
    confidence: number,
    strengths: string[],
    improvements: string[],
  ): string {
    let feedback = '';

    if (confidence >= 85) {
      if (score >= 80) {
        feedback = `Excellent work! Your essay demonstrates strong understanding. (${score}%)`;
      } else if (score >= 70) {
        feedback = `Good response. Your answer covers the main points. (${score}%)`;
      } else {
        feedback = `Your essay needs more development. Focus on the areas below. (${score}%)`;
      }
    } else {
      feedback = `Your essay has been submitted for instructor review. Expected feedback within 24 hours.`;
    }

    if (strengths.length > 0) {
      feedback += ` Strengths: ${strengths[0]}`;
    }

    return feedback;
  }

  /**
   * Sanitize input to prevent injection attacks
   */
  private sanitizeInput(input: string): string {
    // Remove potentially dangerous HTML/script tags
    const sanitized = input
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    // Limit to max characters
    return sanitized.substring(0, 10000);
  }

  /**
   * Create a low confidence result for error cases
   */
  private createLowConfidenceResult(
    message: string,
    confidence: number,
  ): EssayEvaluationResult {
    return {
      score: 0,
      confidence,
      feedback: message,
      strengths: [],
      areasForImprovement: [
        'Awaiting instructor evaluation',
      ],
      keyConceptsFound: [],
      semanticMatch: 0,
      contentRelevance: 0,
      requiresManualReview: true,
      plagarismRisk: 0,
      status: 'requires_review',
    };
  }
}
