import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { UserDto } from '../../users/dto/user.dto.js';
import { RegisterRole } from '../../users/types/user-role.enum.js';
import type { User } from '../../users/types/user.entity.js';
import { UsersService } from '../../users/services/users.service.js';
import type { AuthResponseDto } from '../dto/auth-response.dto.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import type { JwtPayload } from '../types/jwt-payload.js';

dayjs.extend(utc);

const SALT_ROUNDS = 10;
// Latest timezone offset on Earth (UTC+14): a user's local "today" can be
// up to 14h ahead of UTC, so that is the tolerance for the future-dob check.
const MAX_UTC_OFFSET_HOURS = 14;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // dob is a calendar date (no time, no timezone): compared and stored as
    // YYYY-MM-DD and never converted through a timezone.
    if (
      dto.dob &&
      dto.dob >
        dayjs.utc().add(MAX_UTC_OFFSET_HOURS, 'hour').format('YYYY-MM-DD')
    ) {
      throw new BadRequestException('dob cannot be in the future');
    }

    const email = dto.email.toLowerCase();
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email is already registered');
    }

    // Resolve the role by name so no role id is hardcoded. Only RegisterRole
    // values get past validation, so `admin` can never be requested here.
    const roleId = await this.usersService.findRoleIdByName(
      dto.role ?? RegisterRole.STUDENT,
    );
    if (roleId === undefined) {
      throw new InternalServerErrorException(
        'Roles are not set up: run database/seed.sql',
      );
    }

    let user: User;
    try {
      user = await this.usersService.create({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        password: await bcrypt.hash(dto.password, SALT_ROUNDS),
        image: dto.image ?? null,
        gender: dto.gender ?? null,
        dob: dto.dob ?? null,
        roleId,
      });
    } catch (error) {
      // Prisma P2002 = unique constraint violation: another request registered the same email first
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
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
