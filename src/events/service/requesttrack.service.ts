import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { RequestTrackEntity } from "src/entities/requesttrack.entity";
import { Repository } from "typeorm";
import { ValidateConnectionRes } from "../events.type";



@Injectable()
export class RequestTrackService{
    private logger : Logger = new Logger(RequestTrackService.name);
    constructor(
        @InjectRepository(RequestTrackEntity) 
        private readonly reqTackRepo: Repository<RequestTrackEntity>,
    ) {}

    async validateConnectionACk(ack: ValidateConnectionRes) {
        try{
            ack.operations.forEach(async it=> {
                await this.reqTackRepo.update(
                    {
                        workerId: ack.workerId, taskType: ack.taskType,
                        operation: it.operation, transactionId: ack.transactionId
                    }, 
                    {
                        response: JSON.stringify(it.response),
                        status: it.status
                    }
                )
            })
        }catch(e){
            this.logger.log(`Error in Updating ValidateConnectionACk for ${ack.workerId}`)
        }        
    }
}