import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeVoiceVisitService } from './employee-voice-visit.service';

@Module({
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeVoiceVisitService],
})
export class EmployeeModule {}
