import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthErrorCode, type EmployeeProfileDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<EmployeeProfileDto> {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        territory: true,
        joinedAt: true,
      },
    });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.FORBIDDEN_ROLE,
        'Employee profile is not configured.',
        HttpStatus.FORBIDDEN,
      );
    }
    return {
      ...profile,
      joinedAt: profile.joinedAt.toISOString(),
    };
  }
}
