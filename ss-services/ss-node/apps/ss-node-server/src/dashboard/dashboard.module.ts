// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Dashboard aggregation module (module 02)
 *
 * Cross-package aggregation follows the precedent of ./export (DataExportModule):
 * depends on services exported by DeviceModule (device stats) and AlarmModule (alarm-record repository),
 * with the AlarmRecord repository injected via TypeOrmModule.forFeature (switched internally in isolated-database mode).
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlarmRecord } from '@ss-node/ss-alarm';
import { DeviceModule } from '@ss-node/ss-device';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [DeviceModule, TypeOrmModule.forFeature([AlarmRecord])],
  providers: [DashboardService],
  controllers: [DashboardController],
  exports: [DashboardService],
})
export class DashboardModule {}
