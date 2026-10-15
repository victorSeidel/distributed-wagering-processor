import { type ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { BusinessError } from "../../domain/common/errors";

@Catch(BusinessError)
export class BusinessErrorFilter extends BaseExceptionFilter
{
    override catch(err: BusinessError, host: ArgumentsHost)
    {
        super.catch(new HttpException({ statusCode: err.httpStatus, code: err.code, message: err.message }, err.httpStatus), host);
    }
}