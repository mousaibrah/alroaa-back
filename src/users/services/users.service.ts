import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import {
  MediaService,
  type TempFile,
} from '../../media/services/media.service.js';
import type { User as PrismaUser } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateUserDto } from '../dto/create-user.dto.js';
import type { UpdateProfileDto } from '../dto/update-profile.dto.js';
import { assertDobNotInFuture } from '../utils/dob.util.js';
import { normalizePhone } from '../utils/phone.util.js';
import type { Gender, User } from '../types/user.entity.js';

// `dob` is a Postgres DATE, which Prisma reads/writes as a Date at UTC
// midnight, so converting through UTC keeps the calendar date unchanged.
const toUser = (row: PrismaUser): User => ({
  ...row,
  gender: row.gender === null ? null : (Number(row.gender) as Gender),
  dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async findByEmail(email: string): Promise<User | undefined> {
    const row = await this.prisma.user.findFirst({
      where: { email, isDeleted: false },
    });
    return row ? toUser(row) : undefined;
  }

  async findByPhone(
    countryCode: string,
    phoneNumber: string,
  ): Promise<User | undefined> {
    const row = await this.prisma.user.findFirst({
      where: { countryCode, phoneNumber, isDeleted: false },
    });
    return row ? toUser(row) : undefined;
  }

  async findRoleIdByName(name: string): Promise<number | undefined> {
    const role = await this.prisma.role.findFirst({
      where: { name, isDeleted: false },
      select: { id: true },
    });
    return role?.id;
  }

  // Role name plus the permissions granted to it, skipping soft-deleted rows.
  async findAccessByRoleId(
    roleId: number,
  ): Promise<{ role: string; permissions: string[] } | undefined> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, isDeleted: false },
      select: {
        name: true,
        rolePermissions: {
          where: { isDeleted: false, permission: { isDeleted: false } },
          select: { permission: { select: { name: true } } },
        },
      },
    });
    if (!role) return undefined;
    return {
      role: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.name),
    };
  }

  async create(data: CreateUserDto): Promise<User> {
    const row = await this.prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
        image: data.image,
        imageMediaId: data.imageMediaId,
        gender: data.gender,
        dob: data.dob ? new Date(data.dob) : null,
        countryCode: data.countryCode,
        phoneNumber: data.phoneNumber,
        roleId: data.roleId,
      },
    });
    return toUser(row);
  }

  // Uploads a new profile picture: `image` points at it right away and switches
  // to the 320px WebP once processed. The previous picture is deleted.
  async updateImage(user: JwtPayload, file: TempFile): Promise<User> {
    const current = await this.prisma.user.findFirst({
      where: { id: user.sub, isDeleted: false },
      select: { imageMediaId: true },
    });
    if (!current) throw new NotFoundException('User not found');
    const row = await this.media.withUpload(file, 'image', user, (stored) =>
      this.prisma.user.update({
        where: { id: user.sub },
        data: { image: stored?.url, imageMediaId: stored?.mediaId },
      }),
    );
    if (current.imageMediaId) {
      await this.media
        .removeIfUnused(current.imageMediaId)
        .catch(() => undefined);
    }
    return toUser(row);
  }

  async findById(id: number): Promise<User> {
    const row = await this.prisma.user.findFirst({
      where: { id, isDeleted: false },
    });
    if (!row) throw new NotFoundException('User not found');
    return toUser(row);
  }

  // Name, gender, date of birth and phone; `null` clears gender or dob.
  async updateProfile(id: number, dto: UpdateProfileDto): Promise<User> {
    const current = await this.findById(id);
    assertDobNotInFuture(dto.dob);
    const phone = await this.resolvePhoneChange(current, dto);
    try {
      const row = await this.prisma.user.update({
        where: { id },
        data: {
          firstName: dto.firstName?.trim(),
          lastName: dto.lastName?.trim(),
          gender: dto.gender,
          dob:
            dto.dob === undefined
              ? undefined
              : dto.dob
                ? new Date(dto.dob)
                : null,
          countryCode: phone?.countryCode,
          phoneNumber: phone?.phoneNumber,
        },
      });
      return toUser(row);
    } catch (error) {
      // P2002: another account took the number in the meantime.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  // The normalized phone to store, or undefined when it isn't being changed.
  // A missing half is taken from the account, so either can change alone.
  private async resolvePhoneChange(
    current: User,
    dto: UpdateProfileDto,
  ): Promise<{ countryCode: string; phoneNumber: string } | undefined> {
    if (dto.countryCode === undefined && dto.phoneNumber === undefined) {
      return undefined;
    }
    const phoneNumber = dto.phoneNumber ?? current.phoneNumber;
    if (!phoneNumber) {
      throw new BadRequestException(
        'phoneNumber is required: your account has no phone number yet',
      );
    }
    const phone = normalizePhone(
      dto.countryCode ?? current.countryCode,
      phoneNumber,
    );
    const owner = await this.findByPhone(phone.countryCode, phone.phoneNumber);
    if (owner && owner.id !== current.id) {
      throw new ConflictException('Phone number is already registered');
    }
    return phone;
  }

  // Credential changes also end every other session (see JwtAuthGuard).
  async updateCredentials(
    id: number,
    data: { email?: string; password?: string },
  ): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id },
      data: { ...data, passwordChangedAt: new Date() },
    });
    return toUser(row);
  }
}
