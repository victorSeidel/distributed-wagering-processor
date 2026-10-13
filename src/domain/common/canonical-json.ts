import { createHash } from "crypto";

export function canonicalizeJson(obj: unknown): string
{
    if (obj === null || typeof obj !== "object") return JSON.stringify(obj);

    if (Array.isArray(obj)) return `[${obj.map(canonicalizeJson).join(",")}]`;

    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = sortedKeys.map((key) =>
    {
        const val = (obj as Record<string, unknown>)[key];
        return `${JSON.stringify(key)}:${canonicalizeJson(val)}`;
    });

    return `{${pairs.join(",")}}`;
}

export function hashPayload(payload: Record<string, unknown>): string
{
    const canonical = canonicalizeJson(payload);
    return createHash("sha256").update(canonical).digest("hex");
}