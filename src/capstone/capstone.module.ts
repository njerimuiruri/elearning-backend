import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CapstoneController } from './capstone.controller';
import { CapstoneService } from './capstone.service';
import { Capstone, CapstoneSchema } from './capstone.schema';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Capstone.name, schema: CapstoneSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [CapstoneController],
  providers: [CapstoneService],
  exports: [CapstoneService],
})
export class CapstoneModule {}
