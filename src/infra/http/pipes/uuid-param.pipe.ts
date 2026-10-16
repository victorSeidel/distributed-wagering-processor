import { Injectable, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import { assertUuid } from "../../../application/validation/input-validation";

@Injectable()
export class UuidParamPipe implements PipeTransform<string, string>
{
    transform(value: string, metadata: ArgumentMetadata): string
    {
        return assertUuid(value, metadata.data ?? "id");
    }
}