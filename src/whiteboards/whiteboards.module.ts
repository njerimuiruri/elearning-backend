import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Whiteboard, WhiteboardSchema } from './whiteboard.schema';
import { WhiteboardsService } from './whiteboards.service';
import { WhiteboardsController } from './whiteboards.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Whiteboard.name, schema: WhiteboardSchema }]),
  ],
  controllers: [WhiteboardsController],
  providers: [WhiteboardsService],
})
export class WhiteboardsModule {}
