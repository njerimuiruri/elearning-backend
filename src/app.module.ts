import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { CoursesModule } from './courses/courses.module';
import { MessagesModule } from './messages/messages.module';
import { CommonModule } from './common/common.module';
import { CertificateModule } from './certificates/certificate.module';
import { QuestionsModule } from './questions/questions.module';
import { NotesModule } from './notes/notes.module';
import { CategoriesModule } from './categories/categories.module';
import { FilesModule } from './files/files.module';
import { CourseFormatModule } from './course-format/course-format.module';
import { PaymentsModule } from './payments/payments.module';
import { ModulesModule } from './modules/modules.module';
import { ModuleEnrollmentsModule } from './module-enrollments/module-enrollments.module';
import { ProgressionModule } from './progression/progression.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DiscussionsModule } from './discussions/discussions.module';
import { BulkMessagingModule } from './bulk-messaging/bulk-messaging.module';
import { ModuleRatingsModule } from './module-ratings/module-ratings.module';
import { DraftsModule } from './drafts/drafts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: 'elearning',
      }),
    }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
    UsersModule,
    AdminModule,
    CoursesModule,
    MessagesModule,
    CommonModule,
    CertificateModule,
    QuestionsModule,
    NotesModule,
    CategoriesModule,
    FilesModule,
    CourseFormatModule,
    PaymentsModule,
    ModulesModule,
    ModuleEnrollmentsModule,
    ProgressionModule,
    NotificationsModule,
    DiscussionsModule,
    BulkMessagingModule,
    ModuleRatingsModule,
    DraftsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}