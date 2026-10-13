import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { MoneyDto } from '../../common/dto/common.dto';
import { AnalyticsService } from './analytics.service';

export class SpendingQuery {
  @IsEnum(Currency)
  currency!: Currency;

  @IsIn(['CATEGORY', 'MERCHANT'])
  groupBy!: 'CATEGORY' | 'MERCHANT';

  /** Defaults to 30 days before `to`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Defaults to now. */
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class TrendQuery {
  @IsEnum(Currency)
  currency!: Currency;

  @IsIn(['DAY', 'MONTH'])
  granularity!: 'DAY' | 'MONTH';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  periods?: number;
}

export class CurrenciesQuery {
  /** Currency to express the total in (defaults to PKR until user preferences exist). */
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

class SpendingGroupDto {
  key!: string;
  label!: string;
  amount!: MoneyDto;
  count!: number;
  /** Decimal share 0..1 with 4 dp, e.g. "0.2345". */
  share!: string;
}
export class SpendingBreakdownDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;
  from!: string;
  to!: string;
  @ApiProperty({ enum: ['CATEGORY', 'MERCHANT'] })
  groupBy!: 'CATEGORY' | 'MERCHANT';
  total!: MoneyDto;
  @ApiProperty({ type: [SpendingGroupDto] })
  groups!: SpendingGroupDto[];
}

class TrendPointDto {
  /** "2026-10-13" (DAY) or "2026-10" (MONTH), UTC. */
  period!: string;
  in!: MoneyDto;
  out!: MoneyDto;
}
export class TrendDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;
  @ApiProperty({ enum: ['DAY', 'MONTH'] })
  granularity!: 'DAY' | 'MONTH';
  @ApiProperty({ type: [TrendPointDto] })
  points!: TrendPointDto[];
}

class CurrencyItemDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency!: Currency;
  balance!: MoneyDto;
  converted!: MoneyDto;
  share!: string;
}
export class CurrencyBreakdownDto {
  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  preferredCurrency!: Currency;
  total!: MoneyDto;
  rateAsOf!: string;
  @ApiProperty({ type: [CurrencyItemDto] })
  items!: CurrencyItemDto[];
}

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('spending')
  @ApiOkResponse({ type: SpendingBreakdownDto })
  spending(@CurrentUser() user: AuthUser, @Query() q: SpendingQuery): Promise<SpendingBreakdownDto> {
    return this.analytics.spending(user.id, q);
  }

  @Get('trend')
  @ApiOkResponse({ type: TrendDto })
  trend(@CurrentUser() user: AuthUser, @Query() q: TrendQuery): Promise<TrendDto> {
    return this.analytics.trend(user.id, { currency: q.currency, granularity: q.granularity, periods: q.periods ?? (q.granularity === 'DAY' ? 7 : 6) });
  }

  @Get('currencies')
  @ApiOkResponse({ type: CurrencyBreakdownDto })
  currencies(@CurrentUser() user: AuthUser, @Query() q: CurrenciesQuery): Promise<CurrencyBreakdownDto> {
    return this.analytics.currencies(user.id, q.currency ?? 'PKR');
  }
}
