import { Injectable } from "@nestjs/common";



@Injectable()
export class MigrateCommonService {


    async getGroupOfTasksActivity(jobRunId,  groupSize =1000): Promise<string[]> {
      return [];
    }
}
