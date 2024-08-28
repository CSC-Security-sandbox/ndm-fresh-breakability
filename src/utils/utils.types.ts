import { FilterQuery, ProjectionType, QueryOptions } from "mongoose";

export interface DbQuery<T> {
    filter?: FilterQuery<T>,
    projection?: ProjectionType<T>,
    options?: QueryOptions<T>
}