import { Module } from '@nestjs/common';
import { DataModule } from './data/data.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({ imports: [DataModule, DashboardModule] })
export class AppModule {}
