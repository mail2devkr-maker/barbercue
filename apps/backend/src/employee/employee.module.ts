import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeVoiceLogsService } from './employee-voice-logs.service';

@Module({
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeVoiceLogsService],
})
export class EmployeeModule {}
