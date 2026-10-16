import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";

import { ReadinessService } from "../../health/readiness.service";

@Controller("health")
export class HealthController
{
    constructor(private readonly readiness: ReadinessService) {}

    @Get("live")
    live()
    {
        return { status: "UP", timestamp: new Date().toISOString() };
    }

    @Get("ready")
    async ready(@Res() res: Response)
    {
        const report = await this.readiness.check();

        return res.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
            status: report.ready ? "READY" : "NOT_READY",
            checks: report.checks,
            timestamp: new Date().toISOString(),
        });
    }
}
