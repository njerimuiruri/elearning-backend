import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [FilesController],
})
export class FilesModule {}
