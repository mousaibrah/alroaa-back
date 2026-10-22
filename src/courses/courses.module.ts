import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { CourseAccessService } from './services/course-access.service.js';
import { CoursesController } from './controllers/courses.controller.js';
import { CoursesService } from './services/courses.service.js';
import { PlaybackController } from './controllers/playback.controller.js';
import { PlaybackService } from './services/playback.service.js';
import { PlaybackUrlService } from './services/playback-url.service.js';
import { ProgressController } from './controllers/progress.controller.js';
import { ProgressService } from './services/progress.service.js';
import { LessonsController } from './controllers/lessons.controller.js';
import { LessonsService } from './services/lessons.service.js';
import { SectionsController } from './controllers/sections.controller.js';
import { SectionsService } from './services/sections.service.js';

@Module({
  imports: [MediaModule],
  controllers: [
    CoursesController,
    SectionsController,
    LessonsController,
    ProgressController,
    PlaybackController,
  ],
  providers: [
    CourseAccessService,
    CoursesService,
    SectionsService,
    LessonsService,
    ProgressService,
    PlaybackService,
    PlaybackUrlService,
  ],
  exports: [CourseAccessService],
})
export class CoursesModule {}
