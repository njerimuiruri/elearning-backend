import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotesService } from './notes.service';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  /**
   * Create a new note
   * POST /notes
   */
  @Post()
  async createNote(@Request() req, @Body() body: any) {
    const { courseId, courseName, lessonName, content, moduleIndex, moduleName, lessonIndex } = body;

    const note = await this.notesService.createNote(
      req.user.id,
      courseId,
      courseName,
      lessonName,
      content,
      moduleIndex,
      moduleName,
      lessonIndex,
    );

    return {
      success: true,
      message: 'Note created successfully',
      data: note,
    };
  }

  /**
   * Get all notes for logged in student
   * GET /notes
   */
  @Get()
  async getStudentNotes(@Request() req) {
    const notes = await this.notesService.getStudentNotes(req.user.id);

    return {
      success: true,
      data: notes,
    };
  }

  /**
   * IMPORTANT: Specific routes must come BEFORE generic :noteId route
   * This ensures /notes/grouped, /notes/bookmarked, /notes/search/:keyword
   * and /notes/course/:courseId are matched correctly
   */

  /**
   * Get notes grouped by course
   * GET /notes/grouped
   */
  @Get('grouped')
  async getNotesGroupedByCourse(@Request() req) {
    const grouped = await this.notesService.getNotesGroupedByCourse(req.user.id);

    return {
      success: true,
      data: grouped,
    };
  }

  /**
   * Get bookmarked notes
   * GET /notes/bookmarked
   */
  @Get('bookmarked')
  async getBookmarkedNotes(@Request() req) {
    const notes = await this.notesService.getBookmarkedNotes(req.user.id);

    return {
      success: true,
      data: notes,
    };
  }

  /**
   * Search notes by keyword
   * GET /notes/search/:keyword
   */
  @Get('search/:keyword')
  async searchNotes(@Request() req, @Param('keyword') keyword: string) {
    const notes = await this.notesService.searchNotes(req.user.id, keyword);

    return {
      success: true,
      data: notes,
    };
  }

  /**
   * Get notes for a specific course
   * GET /notes/course/:courseId
   */
  @Get('course/:courseId')
  async getCourseNotes(@Request() req, @Param('courseId') courseId: string) {
    const notes = await this.notesService.getCourseNotes(req.user.id, courseId);

    return {
      success: true,
      data: notes,
    };
  }

  /**
   * Create a module-based note
   * POST /notes/module
   */
  @Post('module')
  async createModuleNote(@Request() req, @Body() body: any) {
    const { moduleId, moduleName, lessonIndex, lessonName, content } = body;

    const note = await this.notesService.createModuleNote(
      req.user.id,
      moduleId,
      moduleName,
      lessonIndex,
      lessonName,
      content,
    );

    return {
      success: true,
      message: 'Note created successfully',
      data: note,
    };
  }

  /**
   * Get notes for a specific module
   * GET /notes/module/:moduleId
   */
  @Get('module/:moduleId')
  async getModuleNotes(@Request() req, @Param('moduleId') moduleId: string) {
    const notes = await this.notesService.getModuleNotes(req.user.id, moduleId);

    return {
      success: true,
      data: notes,
    };
  }

  /**
   * Get a specific note by ID
   * GET /notes/:noteId
   * IMPORTANT: This must come AFTER all specific routes
   */
  @Get(':noteId')
  async getNote(@Param('noteId') noteId: string) {
    const note = await this.notesService.getNote(noteId);

    return {
      success: true,
      data: note,
    };
  }

  /**
   * Update a note
   * PUT /notes/:noteId
   */
  @Put(':noteId')
  async updateNote(@Param('noteId') noteId: string, @Body() body: any) {
    const { content, category, tags } = body;

    const note = await this.notesService.updateNote(noteId, content, category, tags);

    return {
      success: true,
      message: 'Note updated successfully',
      data: note,
    };
  }

  /**
   * Toggle bookmark on a note
   * PUT /notes/:noteId/toggle-bookmark
   */
  @Put(':noteId/toggle-bookmark')
  async toggleBookmark(@Param('noteId') noteId: string) {
    const note = await this.notesService.toggleBookmark(noteId);

    return {
      success: true,
      message: 'Bookmark toggled',
      data: note,
    };
  }

  /**
   * Delete a note
   * DELETE /notes/:noteId
   */
  @Delete(':noteId')
  async deleteNote(@Param('noteId') noteId: string) {
    const result = await this.notesService.deleteNote(noteId);

    return result;
  }
}
