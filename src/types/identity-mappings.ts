import { IdentityTypes } from './enums';

export abstract class IdentityMappings {
    jobRunId: string;
    type: IdentityTypes;
    sourceValue: string;
    targetValue: string;

    value = new Map<string, string>();

    constructor({ jobRunId, type, sourceValue, targetValue }: { jobRunId: string; type: IdentityTypes; sourceValue: string; targetValue: string }) {
        this.jobRunId = jobRunId;
        this.type = type;
        this.sourceValue = sourceValue;
        this.targetValue = targetValue;
    }

    abstract init(): Promise<void>;
    abstract close(): Promise<void>;
    abstract cleanup(): Promise<void>;

    getMapping(jobRunId: string, type: IdentityTypes, sourceValue: string): string {
        return `${jobRunId}-${type}-${sourceValue}`;
    }

    async setMapping(jobRunId: string, type: IdentityTypes, sourceValue: string, targetValue: string): Promise<string> {
        this.value.set(this.getMapping(jobRunId, type, sourceValue), targetValue);
        return targetValue;
    }

    getMappedValue(jobRunId: string, type: IdentityTypes, sourceValue: string): string {
        return this.value.get(this.getMapping(jobRunId, type, sourceValue)) || '';
    }

    setMappings(mappings: Map<string, string>[]): void {
        mappings.forEach((mapping) => this.value.set(mapping[0], mapping[1]));
    }

    serialize(): string {
        return JSON.stringify(this);
    }

    deserialize(json: string): void {
        return JSON.parse(json);
    }
}