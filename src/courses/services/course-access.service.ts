import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { UserRole } from '../../users/types/user-role.enum.js';

// Ownership checks shared by the course, section and lesson services.
// Permissions (courses.update, ...) say *what* a role may do; this decides
// *which* courses: the author, or an admin for any course.
@Injectable()
export class CourseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  canManage(user: JwtPayload, authorId: number): boolean {
    return user.role === UserRole.ADMIN || user.sub === authorId;
  }

  private assertCanManage(user: JwtPayload, authorId: number): void {
    if (!this.canManage(user, authorId)) {
      throw new ForbiddenException('You can only manage your own courses');
    }
  }

  async courseForManage(courseId: number, user: JwtPayload) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isDeleted: false },
    });
    if (!course) throw new NotFoundException('Course not found');
    this.assertCanManage(user, course.authorId);
    return course;
  }

  async sectionForManage(sectionId: number, user: JwtPayload) {
    const section = await this.prisma.courseSection.findFirst({
      where: {
        id: sectionId,
        isDeleted: false,
        course: { isDeleted: false },
      },
      include: { course: { select: { authorId: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');
    this.assertCanManage(user, section.course.authorId);
    return section;
  }

  async examForManage(examId: number, user: JwtPayload) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, isDeleted: false, course: { isDeleted: false } },
      include: { course: { select: { authorId: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    this.assertCanManage(user, exam.course.authorId);
    return exam;
  }

  async lessonForManage(lessonId: number, user: JwtPayload) {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isDeleted: false,
        section: { isDeleted: false, course: { isDeleted: false } },
      },
      include: {
        section: {
          select: { id: true, course: { select: { authorId: true } } },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    this.assertCanManage(user, lesson.section.course.authorId);
    return lesson;
  }
}
