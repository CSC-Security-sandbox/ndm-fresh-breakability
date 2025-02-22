import { JobStatus } from "./enums";
import { Serializable } from "./serializable";

export class JobState implements Serializable {
    workers: string[];
    tasks_completed: number;
    tasks_total: number;
    workers_agreed: string[];
    status: JobStatus;

    constructor(
        workers: string[],
        tasks_completed: number,
        tasks_total: number,
        workers_agreed: string[],
        status: JobStatus
    ) {
        this.workers = workers;
        this.tasks_completed = tasks_completed;
        this.tasks_total = tasks_total;
        this.workers_agreed = workers_agreed;
        this.status = status;
    }

    serialize(): string {
        return JSON.stringify(this);
    }

    deserialize(json: string): void {
        const obj = JSON.parse(json);
        this.workers = obj.workers;
        this.tasks_completed = obj.tasks_completed;
        this.tasks_total = obj.tasks_total;
        this.workers_agreed = obj.workers_agreed;
        this.status = obj.status;
    }

    toJSON() {
        return {
            workers: this.workers,
            tasks_completed: this.tasks_completed,
            tasks_total: this.tasks_total,
            workers_agreed: this.workers_agreed,
            status: this.status,
        };
    }
}
