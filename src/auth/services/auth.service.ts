import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { UserDto } from '../../users/dto/user.dto.js';
import { UserRole } from '../../users/types/user-role.enum.js';
import type { User } from '../../users/types/user.entity.js';
import { UsersService } from '../../users/services/users.service.js';
import { assertDobNotInFuture } from '../../users/utils/dob.util.js';
import { normalizePhone } from '../../users/utils/phone.util.js';
import {
  MediaService,
  type TempFile,
} from '../../media/services/media.service.js';
import type { AuthResponseDto } from '../dto/auth-response.dto.js';
import type { ChangePasswordDto } from '../dto/change-credentials.dto.js';
import type {
  ResendVerificationResponseDto,
  VerificationRequiredDto,
  VerifyEmailDto,
} from '../dto/email-verification.dto.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import type { JwtPayload } from '../types/jwt-payload.js';
import {
  EmailVerificationService,
  RESEND_COOLDOWN_SEC,
} from './email-verification.service.js';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly media: MediaService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  // `image` is the optional profile picture: stored before the account exists
  // (no owner yet), then handed to the new user. No token yet: the account
  // logs in once the emailed code is entered (POST /auth/verify-email).
  async register(
    dto: RegisterDto,
    image?: TempFile,
  ): Promise<VerificationRequiredDto> {
    assertDobNotInFuture(dto.dob);
    const phone = normalizePhone(dto.countryCode, dto.phoneNumber);

    const email = dto.email.toLowerCase();
    // Every new account is a `user`; admins are only created in the database.
    // Resolved by name so no role id is hardcoded. The three lookups don't
    // depend on each other, so they run together.
    const [emailOwner, phoneOwner, roleId] = await Promise.all([
      this.usersService.findByEmail(email),
      this.usersService.findByPhone(phone.countryCode, phone.phoneNumber),
      this.usersService.findRoleIdByName(UserRole.USER),
    ]);
    if (emailOwner) {
      throw new ConflictException('Email is already registered');
    }
    if (phoneOwner) {
      throw new ConflictException('Phone number is already registered');
    }

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
          countryCode: phone.countryCode,
          phoneNumber: phone.phoneNumber,
          roleId,
        }),
      );
    } catch (error) {
      // Prisma P2002 = unique constraint violation: another request registered
      // the same email or phone first; the email check tells which.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          (await this.usersService.findByEmail(email))
            ? 'Email is already registered'
            : 'Phone number is already registered',
        );
      }
      throw error;
    }

    if (user.imageMediaId) {
      await this.media.setOwner(user.imageMediaId, user.id);
    }
    return this.requireVerification(user, true);
  }

  // An unverified account gets a fresh code instead of a token (only after the
  // password is checked, so it reveals nothing about unknown emails).
  async login(
    dto: LoginDto,
  ): Promise<AuthResponseDto | VerificationRequiredDto> {
    const user = await this.usersService.findByEmail(dto.email.toLowerCase());
    // Same error for unknown email and wrong password to avoid user enumeration.
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerifiedAt) return this.requireVerification(user);

    return this.buildResponse(user);
  }

  // Entering the right code verifies the email and logs the user in.
  async verifyEmail(dto: VerifyEmailDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email.toLowerCase());
    if (!user) throw new BadRequestException('The code is incorrect');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('This email is already verified');
    }
    await this.emailVerification.verify(user, dto.code);
    return this.buildResponse(user);
  }

  // Answers the same for unknown and already verified emails, so it can't be
  // used to find out which addresses have an account.
  async resendVerification(
    email: string,
  ): Promise<ResendVerificationResponseDto> {
    const user = await this.usersService.findByEmail(email.toLowerCase());
    if (!user || user.emailVerifiedAt) {
      return { resendAvailableIn: RESEND_COOLDOWN_SEC };
    }
    return {
      resendAvailableIn: await this.emailVerification.resend(user),
    };
  }

  // Asks for the current password, signs out every other session, and hands
  // back a fresh token for this one.
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
    const updated = await this.usersService.updatePassword(
      user.id,
      await bcrypt.hash(dto.newPassword, SALT_ROUNDS),
    );
    return this.buildResponse(updated);
  }

  // Sends a code (unless one just went out). A failed email doesn't undo the
  // registration: the user can ask for a new code right away.
  private async requireVerification(
    user: User,
    isNewAccount = false,
  ): Promise<VerificationRequiredDto> {
    let resendAvailableIn = 0;
    try {
      resendAvailableIn = await this.emailVerification.send(user, isNewAccount);
    } catch (err) {
      this.logger.error('Could not send the verification code', err as Error);
    }
    return { verificationRequired: true, email: user.email, resendAvailableIn };
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
