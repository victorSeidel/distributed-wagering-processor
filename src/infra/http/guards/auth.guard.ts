import { type CanActivate, Injectable } from "@nestjs/common";

/**
 * PONTO DE EXTENSÃO DE AUTENTICAÇÃO (no-op deliberado).
 *
 * O desafio não pontua autenticação; a decisão e o desenho que adotaríamos estão em ARCHITECTURE.md.
 * Para ativar, substitua `canActivate` pela verificação do token; os endpoints de health e de métricas não usam este guard e permanecem abertos.
 */
@Injectable()
export class AuthGuard implements CanActivate
{
    canActivate(): boolean
    {
        return true;
    }
}