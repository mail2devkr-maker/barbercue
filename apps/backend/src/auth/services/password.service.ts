import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// Staff/owner/admin accounts only — customers authenticate via OTP and never have a password.
const BCRYPT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  }

  compare(plainPassword: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, passwordHash);
  }
}
