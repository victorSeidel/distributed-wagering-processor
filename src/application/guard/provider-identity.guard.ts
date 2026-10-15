import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class ProviderIdentityGuard implements CanActivate
{
    canActivate(context: ExecutionContext): boolean
    {
        const request = context.switchToHttp().getRequest();
        if (request.url.startsWith("/health")) return true;

        request.providerIdentity = request.headers["x-provider-id"] || "provider-default";
        return true;
    }
}