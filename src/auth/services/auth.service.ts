import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { UserDto } from '../../users/dto/user.dto.js';
import { UserRole } from '../../users/types/user-role.enum.js';
import type { User } from '../../users/types/user.entity.js';
import { UsersService } from '../../users/services/users.service.js';
import { assertDobNotInFuture } from '../../users/utils/dob.util.js';
import {
  MediaService,
  type TempFile,
} from '../../media/services/media.service.js';
import type { AuthResponseDto } from '../dto/auth-response.dto.js';
import type {
  ChangeEmailDto,
  ChangePasswordDto,
} from '../dto/change-credentials.dto.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import type { JwtPayload } from '../types/jwt-payload.js';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly media: MediaService,
  ) {}

  // `image` is the optional profile picture: stored before the account exists
  // (no owner yet), then handed to the new user.
  async register(dto: RegisterDto, image?: TempFile): Promise<AuthResponseDto> {
    assertDobNotInFuture(dto.dob);

    const email = dto.email.toLowerCase();
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email is already registered');
    }

    // Every new account is a `user`; admins are only created in the database.
    // Resolved by name so no role id is hardcoded.
    const roleId = await this.usersService.findRoleIdByName(UserRole.USER);
    if (roleId === undefined) {
      throw new InternalServerErrorException(
        'Roles are not set up: run database/seed.sql',
      );
    }

    const password = await bcrypt.hash(dto.password, SALT_ROUNDS);
    let user: User;
    try {
      user = await this.media.withUpload(image, 'image', null, (stored) =>
        this.usersService.create({
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
          password,
          image: stored?.url ?? null,
          imageMediaId: stored?.mediaId ?? null,
          gender: dto.gender ?? null,
          dob: dto.dob ?? null,
          roleId,
        }),
      );
    } catch (error) {
      // Prisma P2002 = unique constraint violation: another request registered the same email first
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }

    if (user.imageMediaId) {
      await this.media.setOwner(user.imageMediaId, user.id);
    }
    return this.buildResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email.toLowerCase());
    // Same error for unknown email and wrong password to avoid user enumeration.
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildResponse(user);
  }

  // Both credential changes ask for the current password, sign out every other
  // session, and hand back a fresh token for this one.
  async changePassword(
    caller: JwtPayload,
    dto: ChangePasswordDto,
  ): Promise<AuthResponseDto> {
    const user = await this.verifyPassword(caller.sub, dto.currentPassword);
    if (await bcrypt.compare(dto.newPassword, user.password)) {
      throw new BadRequestException(
        'The new password must differ from the current one',
      );
    }
    const updated = await this.usersService.updateCredentials(user.id, {
      password: await bcrypt.hash(dto.newPassword, SALT_ROUNDS),
    });
    return this.buildResponse(updated);
  }

  async changeEmail(
    caller: JwtPayload,
    dto: ChangeEmailDto,
  ): Promise<AuthResponseDto> {
    const user = await this.verifyPassword(caller.sub, dto.currentPassword);
    const email = dto.email.toLowerCase();
    if (email === user.email) {
      throw new BadRequestException('This is already your email');
    }
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email is already registered');
    }
    try {
      return this.buildResponse(
        await this.usersService.updateCredentials(user.id, { email }),
      );
    } catch (error) {
      // P2002: another account took the address in the meantime.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  // 403, not 401: the session is valid, only the password is wrong (a 401
  // would log the frontend out).
  private async verifyPassword(userId: number, password: string) {
    const user = await this.usersService.findById(userId);
    if (!(await bcrypt.compare(password, user.password))) {
      throw new ForbiddenException('Current password is incorrect');
    }
    return user;
  }

  private async buildResponse(user: User): Promise<AuthResponseDto> {
    const access = await this.usersService.findAccessByRoleId(user.roleId);
    if (!access) {
      // The user's role was deleted: refuse rather than issue a token with no
      // meaningful role.
      throw new UnauthorizedException('Account has no active role');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      role: access.role,
      permissions: access.permissions,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user: UserDto.from(user),
      role: access.role,
      accessToken,
    };
  }
}
