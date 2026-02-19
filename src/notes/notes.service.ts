import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from './notes.schema';

@Injectable()
export class NotesService {
  constructor(@InjectModel(Note.name) private noteModel: Model<NoteDocument>) {}

  /**
   * Create a new note (course-based)
   */
  async createNote(
    studentId: string,
    courseId: string,
    courseName: string,
    lessonName: string,
    content: string,
    moduleIndex?: number,
    moduleName?: string,
    lessonIndex?: number,
  ): Promise<NoteDocument> {
    try {
      const note = new this.noteModel({
        studentId: new Types.ObjectId(studentId),
        courseId: new Types.ObjectId(courseId),
        courseName,
        moduleIndex,
        moduleName,
        lessonIndex,
        lessonName,
        content,
        tags: [],
      });

      return await note.save();
    } catch (error) {
      throw new BadRequestException(`Failed to create note: ${error.message}`);
    }
  }

  /**
   * Create a module-based note (for module lessons)
   */
  async createModuleNote(
    studentId: string,
    moduleId: string,
    moduleName: string,
    lessonIndex: number,
    lessonName: string,
    content: string,
  ): Promise<NoteDocument> {
    try {
      const note = new this.noteModel({
        studentId: new Types.ObjectId(studentId),
        moduleId: new Types.ObjectId(moduleId),
        moduleName,
        lessonIndex,
        lessonName,
        content,
        tags: [],
      });

      return await note.save();
    } catch (error) {
      throw new BadRequestException(`Failed to create module note: ${error.message}`);
    }
  }

  /**
   * Get notes for a specific module
   */
  async getModuleNotes(studentId: string, moduleId: string): Promise<NoteDocument[]> {
    try {
      return (await this.noteModel
        .find({
          studentId: new Types.ObjectId(studentId),
          moduleId: new Types.ObjectId(moduleId),
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec()) as any;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch module notes: ${error.message}`);
    }
  }

  /**
   * Get all notes for a student
   */
  async getStudentNotes(studentId: string): Promise<NoteDocument[]> {
    try {
      return (await this.noteModel
        .find({ studentId: new Types.ObjectId(studentId) })
        .sort({ createdAt: -1 })
        .lean()
        .exec()) as any;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch notes: ${error.message}`);
    }
  }

  /**
   * Get all notes for a specific course
   */
  async getCourseNotes(studentId: string, courseId: string): Promise<NoteDocument[]> {
    try {
      return (await this.noteModel
        .find({
          studentId: new Types.ObjectId(studentId),
          courseId: new Types.ObjectId(courseId),
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec()) as any;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch course notes: ${error.message}`);
    }
  }

  /**
   * Get notes grouped by course
   */
  async getNotesGroupedByCourse(studentId: string): Promise<any[]> {
    try {
      const notes = await this.noteModel
        .find({ studentId: new Types.ObjectId(studentId) })
        .sort({ courseId: 1, createdAt: -1 })
        .lean()
        .exec();

      // Group by course
      const grouped = new Map();
      notes.forEach((note) => {
        const courseKey = note.courseId?.toString() || note.moduleId?.toString() || 'unknown';
        if (!grouped.has(courseKey)) {
          grouped.set(courseKey, {
            courseId: note.courseId,
            courseName: note.courseName,
            noteCount: 0,
            notes: [],
            lastUpdated: note.updatedAt,
          });
        }
        const courseGroup = grouped.get(courseKey);
        courseGroup.notes.push(note);
        courseGroup.noteCount += 1;
        courseGroup.lastUpdated = note.updatedAt > courseGroup.lastUpdated ? note.updatedAt : courseGroup.lastUpdated;
      });

      return Array.from(grouped.values());
    } catch (error) {
      throw new BadRequestException(`Failed to fetch grouped notes: ${error.message}`);
    }
  }

  /**
   * Get a single note by ID
   */
  async getNote(noteId: string): Promise<NoteDocument> {
    try {
      const note = (await this.noteModel
        .findById(new Types.ObjectId(noteId))
        .lean()
        .exec()) as any;

      if (!note) {
        throw new BadRequestException('Note not found');
      }

      return note;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch note: ${error.message}`);
    }
  }

  /**
   * Update a note
   */
  async updateNote(noteId: string, content: string, category?: string, tags?: string[]): Promise<NoteDocument> {
    try {
      const note = await this.noteModel.findByIdAndUpdate(
        new Types.ObjectId(noteId),
        {
          content,
          category,
          tags,
          updatedAt: new Date(),
        },
        { new: true },
      );

      if (!note) {
        throw new BadRequestException('Note not found');
      }

      return note;
    } catch (error) {
      throw new BadRequestException(`Failed to update note: ${error.message}`);
    }
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.noteModel.findByIdAndDelete(new Types.ObjectId(noteId));

      if (!result) {
        throw new BadRequestException('Note not found');
      }

      return { success: true, message: 'Note deleted successfully' };
    } catch (error) {
      throw new BadRequestException(`Failed to delete note: ${error.message}`);
    }
  }

  /**
   * Toggle bookmark status
   */
  async toggleBookmark(noteId: string): Promise<NoteDocument> {
    try {
      const note = await this.noteModel.findById(new Types.ObjectId(noteId));

      if (!note) {
        throw new BadRequestException('Note not found');
      }

      note.isBookmarked = !note.isBookmarked;
      return await note.save();
    } catch (error) {
      throw new BadRequestException(`Failed to toggle bookmark: ${error.message}`);
    }
  }

  /**
   * Search notes by keyword
   */
  async searchNotes(studentId: string, keyword: string): Promise<NoteDocument[]> {
    try {
      return (await this.noteModel
        .find({
          studentId: new Types.ObjectId(studentId),
          $or: [
            { content: { $regex: keyword, $options: 'i' } },
            { lessonName: { $regex: keyword, $options: 'i' } },
            { courseName: { $regex: keyword, $options: 'i' } },
          ],
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec()) as any;
    } catch (error) {
      throw new BadRequestException(`Failed to search notes: ${error.message}`);
    }
  }

  /**
   * Get bookmarked notes
   */
  async getBookmarkedNotes(studentId: string): Promise<NoteDocument[]> {
    try {
      return (await this.noteModel
        .find({
          studentId: new Types.ObjectId(studentId),
          isBookmarked: true,
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec()) as any;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch bookmarked notes: ${error.message}`);
    }
  }
}
