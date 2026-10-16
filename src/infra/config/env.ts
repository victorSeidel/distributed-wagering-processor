export function requireEnv(name: string): string
{
    const value = process.env[name];
    if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
    return value;
}

export function optionalEnv(name: string, fallback: string): string
{
    return process.env[name] || fallback;
}