import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { RequestTrackEntity } from "src/entities/requesttrack.entity";
import { Repository } from "typeorm";
import { ListPathRes, ValidateConnectionRes } from "../events.type";
import { FileConfigService } from "./config.service";



@Injectable()
export class RequestTrackService{
    private logger : Logger = new Logger(RequestTrackService.name);
    constructor(
        @InjectRepository(RequestTrackEntity) 
        private readonly reqTackRepo: Repository<RequestTrackEntity>,
        private readonly configService: FileConfigService,
    ) {}

      // --------------------- VALIDATE CONNECTION ACK --------------------- //
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


    // --------------------- LIST PATH ACK --------------------- //
    async listPathAck(ack: ListPathRes) {
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
            const request = await this.reqTackRepo.findOne({where: {
                workerId: ack.workerId, taskType: ack.taskType,
                transactionId: ack.transactionId
            }})

            if(!request) {
                this.logger.error(`Request Not Found for ${ack.transactionId}`)
                return 
            }
            await this.configService.updatePathToConfig(request.configId, ack)
        }catch(e){
            this.logger.log(`Error in Updating listPathAck for ${ack.workerId}`)
        }        
    }

}