import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Whiteboard, WhiteboardDocument } from './whiteboard.schema';

@Injectable()
export class WhiteboardsService {
  constructor(
    @InjectModel(Whiteboard.name) private whiteboardModel: Model<WhiteboardDocument>,
  ) {}

  async create(instructorId: string, title: string, pages: any[][], textLayers: any[][]) {
    const wb = new this.whiteboardModel({
      instructorId: new Types.ObjectId(instructorId),
      title: title || 'Untitled Whiteboard',
      pages: pages?.length ? pages : [[]],
      textLayers: textLayers?.length ? textLayers : [[]],
    });
    return wb.save();
  }

  async getMyWhiteboards(instructorId: string) {
    return this.whiteboardModel
      .find({ instructorId: new Types.ObjectId(instructorId) })
      .select('-pages')
      .sort({ updatedAt: -1 })
      .lean();
  }

  async getById(id: string) {
    const wb = await this.whiteboardModel
      .findById(id)
      .populate('instructorId', 'firstName lastName')
      .lean();
    if (!wb) throw new NotFoundException('Whiteboard not found');
    return wb;
  }

  async update(id: string, instructorId: string, title: string, pages: any[][], textLayers: any[][]) {
    const wb = await this.whiteboardModel.findById(id);
    if (!wb) throw new NotFoundException('Whiteboard not found');
    if (wb.instructorId.toString() !== instructorId) throw new ForbiddenException();

    if (title !== undefined) wb.title = title;
    if (pages !== undefined) wb.pages = pages;
    if (textLayers !== undefined) wb.textLayers = textLayers;
    return wb.save();
  }

  async share(id: string, instructorId: string, categoryIds: string[]) {
    const wb = await this.whiteboardModel.findById(id);
    if (!wb) throw new NotFoundException('Whiteboard not found');
    if (wb.instructorId.toString() !== instructorId) throw new ForbiddenException();

    wb.sharedWith = categoryIds.map((c) => new Types.ObjectId(c));
    wb.isShared = categoryIds.length > 0;
    return wb.save();
  }

  async delete(id: string, instructorId: string) {
    const wb = await this.whiteboardModel.findById(id);
    if (!wb) throw new NotFoundException('Whiteboard not found');
    if (wb.instructorId.toString() !== instructorId) throw new ForbiddenException();
    await wb.deleteOne();
    return { success: true, message: 'Whiteboard deleted' };
  }

  async getAllWhiteboards() {
    return this.whiteboardModel
      .find()
      .select('-pages -textLayers')
      .populate('instructorId', 'firstName lastName email')
      .populate('sharedWith', 'name')
      .sort({ updatedAt: -1 })
      .lean();
  }

  async adminDelete(id: string) {
    const wb = await this.whiteboardModel.findById(id);
    if (!wb) throw new NotFoundException('Whiteboard not found');
    await wb.deleteOne();
    return { success: true, message: 'Whiteboard deleted' };
  }

  async getSharedForCategory(categoryId: string) {
    return this.whiteboardModel
      .find({
        isShared: true,
        sharedWith: new Types.ObjectId(categoryId),
      })
      .select('-pages')
      .populate('instructorId', 'firstName lastName')
      .sort({ updatedAt: -1 })
      .lean();
  }
}
