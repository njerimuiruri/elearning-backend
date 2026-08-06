import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface EssayAiInsightsResult {
  summary?: string;
  keyTakeaways?: string[];
  mainPoints?: string[];
  keyThemes?: string[];
  suggestedKeywords?: string[];
  improvementSuggestions?: string[];
  addressesRequirements?: 'yes' | 'partial' | 'no';
  addressesRequirementsRationale?: string;
  wordCount: number;
  readingTimeMinutes: number;
  generationStatus: 'completed' | 'failed';
  generatedAt: Date;
  generationError?: string;
  modelUsed?: string;
}

interface GenerateParams {
  essayText: string;
  questionText: string;
  rubric?: string;
  moduleTitle?: string;
}

const MAX_ESSAY_CHARS = 12000;
const MAX_LIST_ITEMS = 8;
const ALLOWED_ALIGNMENT = ['yes', 'partial', 'no'];

@Injectable()
export class GroqEssayInsightsService {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly endpoint = 'https://api.groq.com/openai/v1/chat/completions';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GROQ_API_KEY');
    this.model =
      this.configService.get<string>('GROQ_MODEL') ||
      'llama-3.3-70b-versatile';

    if (!this.apiKey) {
      console.warn(
        'GROQ_API_KEY is not set. Essay AI insights generation will fail until it is configured.',
      );
    }
  }

  async generateEssayInsights(
    params: GenerateParams,
  ): Promise<EssayAiInsightsResult> {
    const wordCount = this.countWords(params.essayText);
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'AI insights are not configured',
      );
    }

    try {
      const raw = await this.callGroq(params);
      const parsed = this.parseResponse(raw);

      return {
        summary: parsed.summary,
        keyTakeaways: this.clampList(parsed.keyTakeaways),
        mainPoints: this.clampList(parsed.mainPoints),
        keyThemes: this.clampList(parsed.keyThemes),
        suggestedKeywords: this.clampList(parsed.suggestedKeywords),
        improvementSuggestions: this.clampList(parsed.improvementSuggestions),
        addressesRequirements: this.normalizeAlignment(
          parsed.addressesRequirements,
        ),
        addressesRequirementsRationale: parsed.addressesRequirementsRationale,
        wordCount,
        readingTimeMinutes,
        generationStatus: 'completed',
        generatedAt: new Date(),
        modelUsed: this.model,
      };
    } catch (err: any) {
      return {
        wordCount,
        readingTimeMinutes,
        generationStatus: 'failed',
        generatedAt: new Date(),
        generationError: this.describeError(err),
        modelUsed: this.model,
      };
    }
  }

  private async callGroq(params: GenerateParams): Promise<string> {
    const systemPrompt = `You are an academic writing analysis assistant. You will be given a student's essay along with the assignment question (and optionally a grading rubric). Respond with STRICT JSON ONLY — no markdown code fences, no prose outside the JSON object. The JSON object must have exactly these keys:
{
  "summary": string (2-4 sentence concise summary of the essay),
  "keyTakeaways": string[] (up to 6 short bullet points),
  "mainPoints": string[] (up to 6 main points/arguments discussed),
  "keyThemes": string[] (up to 6 short theme/topic labels),
  "suggestedKeywords": string[] (up to 8 keywords),
  "improvementSuggestions": string[] (up to 5 optional suggestions or areas needing further review; empty array if none),
  "addressesRequirements": "yes" | "partial" | "no" (does the essay address the assignment question/rubric),
  "addressesRequirementsRationale": string (one sentence explaining the addressesRequirements judgment)
}`;

    const userPrompt = `Assignment question:\n${params.questionText || '(not provided)'}\n\nGrading rubric:\n${params.rubric || 'No rubric provided'}\n\nModule: ${params.moduleTitle || '(unknown)'}\n\nStudent essay:\n${this.truncate(params.essayText)}`;

    const response = await axios.post(
      this.endpoint,
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq');
    return content;
  }

  private parseResponse(raw: string): any {
    try {
      return JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // fall through
        }
      }
      throw new Error('Failed to parse AI response as JSON');
    }
  }

  private clampList(list: unknown): string[] | undefined {
    if (!Array.isArray(list)) return undefined;
    return list
      .filter((item) => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_LIST_ITEMS);
  }

  private normalizeAlignment(
    value: unknown,
  ): 'yes' | 'partial' | 'no' {
    if (typeof value === 'string' && ALLOWED_ALIGNMENT.includes(value)) {
      return value as 'yes' | 'partial' | 'no';
    }
    return 'partial';
  }

  private truncate(text: string): string {
    if (!text) return '';
    return text.length > MAX_ESSAY_CHARS
      ? `${text.slice(0, MAX_ESSAY_CHARS)}\n\n[...truncated...]`
      : text;
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }

  private describeError(err: any): string {
    const status = err?.response?.status;
    if (status === 401) return 'Invalid or missing Groq API key';
    if (status === 429) return 'Groq rate limit exceeded, please try again shortly';
    return err?.message || 'Unknown error generating AI insights';
  }
}
