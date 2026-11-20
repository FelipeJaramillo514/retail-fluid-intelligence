import { Controller, Get, Header, InternalServerErrorException, Logger, Query } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

const NO_STORE = 'no-store';

@Controller('api')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboard: DashboardService) {}

  @Get('meta')
  @Header('Cache-Control', NO_STORE)
  meta() {
    return this.dashboard.metadata;
  }

  @Get('dashboard')
  @Header('Cache-Control', NO_STORE)
  getDashboard(
    @Query('year') year?: string,
    @Query('country') country?: string,
    @Query('region') region?: string,
    @Query('productLine') productLine?: string,
  ) {
    const filters = {
      year: typeof year === 'string' ? year : null,
      country: typeof country === 'string' ? country : null,
      region: typeof region === 'string' ? region : null,
      productLine: typeof productLine === 'string' ? productLine : null,
    };
    this.dashboard.validate(filters);
    try {
      return this.dashboard.build(filters);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(error);
      throw new InternalServerErrorException('No se pudo calcular el tablero.');
    }
  }
}
