/**
 * Identity map mínimo de uma TransactionScope: associa cada agregado carregado/adicionado à sua entidade gerenciada.
 * 'save()' copia o estado de volta sem nova consulta (funciona para entidades adicionadas na mesma transação e ainda não persistidas).
 */
export class TrackedEntities<TEntity>
{
    private readonly entities = new Map<string, TEntity>();

    public track(key: string, entity: TEntity): TEntity
    {
        this.entities.set(key, entity);
        return entity;
    }

    public require(key: string): TEntity
    {
        const entity = this.entities.get(key);
        if (!entity) throw new Error(`Agregado '${key}' não foi carregado nem adicionado nesta transação`);
        return entity;
    }
}