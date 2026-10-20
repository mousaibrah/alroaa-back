import { Injectable } from '@nestjs/common';
import type { User as PrismaUser } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateUserDto } from '../dto/create-user.dto.js';
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
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | undefined> {
    const row = await this.prisma.user.findFirst({
      where: { email, isDeleted: false },
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
        gender: data.gender,
        dob: data.dob ? new Date(data.dob) : null,
        roleId: data.roleId,
      },
    });
    return toUser(row);
  }
}
