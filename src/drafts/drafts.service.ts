import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Draft, DraftDocument } from './draft.schema';
import { UpsertDraftDto } from './dto/upsert-draft.dto';

@Injectable()
export class DraftsService {
  constructor(
    @InjectModel(Draft.name) private readonly draftModel: Model<DraftDocument>,
  ) {}

  async upsert(userId: string, draftKey: string, dto: UpsertDraftDto): Promise<Draft> {
    return this.draftModel
      .findOneAndUpdate(
        { userId, draftKey },
        {
          userId,
          draftKey,
          contentType: dto.contentType,
          data: dto.data,
          entityId: dto.entityId,
          title: dto.title,
          lastSavedAt: new Date(),
        },
        { upsert: true, new: true },
      )
      .exec() as Promise<Draft>;
  }

  async get(userId: string, draftKey: string): Promise<Draft | null> {
    return this.draftModel.findOne({ userId, draftKey }).exec();
  }

  async getUserDrafts(userId: string): Promise<Draft[]> {
    return this.draftModel.find({ userId }).sort({ lastSavedAt: -1 }).exec();
  }

  async discard(userId: string, draftKey: string): Promise<void> {
    await this.draftModel.deleteOne({ userId, draftKey }).exec();
  }
}
