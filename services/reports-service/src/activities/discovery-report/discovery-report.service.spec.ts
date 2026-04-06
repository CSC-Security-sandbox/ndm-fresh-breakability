import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryReportService } from "./discovery-report.service";
import { PDFGeneratorService } from "src/generator/pdf-generator.service";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ReportsEntity } from "src/entities/reports.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { DataSource, Repository } from "typeorm";
import * as fs from "fs";
import { ReportType } from "src/constants/enums";
import { PDFTemplate } from "src/generator/pdf-generator.type";
import { groupAndOrder } from "src/utils/group-order";
import { escapeCsvValue } from "src/utils/utils";
import { ProjectIdCacheService } from '../../utils/project-id-cache.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock("fs");

(fs.promises as any) = {
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
};

(fs.createWriteStream as jest.Mock).mockReturnValue({
    on: jest.fn((event: string, cb: () => void) => { if (event === "close") cb(); }),
});

jest.mock("src/utils/group-order");
jest.mock("src/utils/utils");
jest.mock("src/generator/pdf-generator.service", () => {
    return {
        PDFGeneratorService: jest.fn().mockImplementation(() => ({
            generatePDF: jest.fn(),
            mergePDFs: jest.fn(),
            addWatermark: jest.fn(),
        })),
    };
});

jest.mock("./query/discovery-report.query-mapper", () => ({
    QueryMapper: {
        section1: {
            query: jest.fn((schema) => "SELECT * FROM section1"),
            mapper: jest.fn().mockReturnValue([{ id: 1, name: "test" }]),
            isDynamic: false
        },
    },
}));

describe("DiscoveryReportService", () => {
    let service: DiscoveryReportService;
    let dataSource: DataSource;
    let pdfGenerator: jest.Mocked<PDFGeneratorService>;
    let configService: ConfigService;
    let reportsRepo: Repository<ReportsEntity>;
    let jobRunRepo: Repository<JobRunEntity>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DiscoveryReportService,
                {
                    provide: DataSource,
                    useValue: { query: jest.fn() },
                },
                {
                    provide: PDFGeneratorService,
                    useClass: PDFGeneratorService,
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string) => {
                            if (key === "app.baseDir") return "/tmp";
                            if (key === "typeorm.schema") return "testschema";
                            return undefined;
                        }),
                    },
                },
                {
                    provide: getRepositoryToken(ReportsEntity),
                    useValue: {
                        findOne: jest.fn(),
                        create: jest.fn(),
                        save: jest.fn(),
                    },
                },
                {
                    provide: getRepositoryToken(JobRunEntity),
                    useValue: {
                        update: jest.fn(),
                    },
                },
                {
                    provide: ProjectIdCacheService,
                    useValue: {
                        getProjectIdFromCache: jest.fn().mockResolvedValue('project-123'),
                    },
                },
                {
                    provide: LoggerFactory,
                    useValue: {
                        create: jest.fn().mockReturnValue({
                            info: jest.fn(),
                            error: jest.fn(),
                            warn: jest.fn(),
                            debug: jest.fn(),
                            log: jest.fn(),
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get<DiscoveryReportService>(DiscoveryReportService);
        dataSource = module.get<DataSource>(DataSource);
        pdfGenerator = module.get(PDFGeneratorService) as jest.Mocked<PDFGeneratorService>;
        configService = module.get<ConfigService>(ConfigService);
        reportsRepo = module.get<Repository<ReportsEntity>>(getRepositoryToken(ReportsEntity));
        jobRunRepo = module.get<Repository<JobRunEntity>>(getRepositoryToken(JobRunEntity));

        jest.clearAllMocks();
    });

    describe("getSection", () => {
        it("should query and map the section data", async () => {
            (dataSource.query as jest.Mock).mockResolvedValue([{ id: 1, name: "test" }]);
            const result = await service.getSection({ jobRunId: "123", section: "section1", updateSection: false } as any);
            expect(dataSource.query).toHaveBeenCalledWith("SELECT * FROM section1", ["123"]);
            expect(result).toEqual([{ id: 1, name: "test" }]);
        });

        it("should throw if section does not exist", async () => {
            await expect(
                service.getSection({ jobRunId: "1", section: "doesnotexist", updateSection: false } as any)
            ).rejects.toThrow();
        });

        it("should update section when updateSection is true", async () => {
            const mockData = [{ id: 1, name: "test" }];
            (dataSource.query as jest.Mock).mockResolvedValue(mockData);
            const updateSpy = jest.spyOn(service, 'updateJsonReport').mockResolvedValue("Updated The report Data Successfully");
            
            const result = await service.getSection({ jobRunId: "123", section: "section1", updateSection: true } as any);
            
            expect(updateSpy).toHaveBeenCalledWith({ jobRunId: "123", data: mockData, updateType: 'data' });
            expect(result).toEqual([]);
        });
    });

    describe("generatePdfReport", () => {
        it("should generate PDF and write to file", async () => {
            const fakeBuffer = Buffer.from("pdfdata");
            const mockReport = {
                id: 1,
                jobRunId: "42",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([{ foo: "bar" }])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ category: [] });
            (pdfGenerator.generatePDF as jest.Mock).mockResolvedValue(fakeBuffer);
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: "42" };
            const result = await service.generatePdfReport(input as any);

            expect(reportsRepo.findOne).toHaveBeenCalledWith({
                where: { jobRunId: "42", reportType: ReportType.DISCOVERY }
            });
            expect(groupAndOrder).toHaveBeenCalledWith([{ foo: "bar" }], ReportType.DISCOVERY);
            expect(pdfGenerator.generatePDF).toHaveBeenCalledWith({
                context: {
                    jobRunId: "42",
                    projectId: "project-123"
                },
                data: { category: [] },
                template: PDFTemplate.DISCOVERY_REPORT,
                pdfOptions: {
                    format: 'A2',
                    printBackground: true,
                    scale: 0.5,
                    landscape: false,
                    width: '420mm',
                    height: '594mm',
                }
            });
            expect(fs.promises.writeFile).toHaveBeenCalledWith("/tmp/42-discover-report.pdf", fakeBuffer);
            expect(result).toEqual({
                message: "PDF report generated successfully",
                path: "/tmp/42-discover-report.pdf",
            });
        });

        it("should throw if PDF generation fails", async () => {
            const mockReport = {
                id: 1,
                jobRunId: "777",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ category: [] });
            (pdfGenerator.generatePDF as jest.Mock).mockRejectedValue(new Error("fail"));

            const input = { jobRunId: "777" };
            await expect(service.generatePdfReport(input as any)).rejects.toThrow("fail");
        });

        it("should throw error when no report found in database", async () => {
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(null);
            
            const input = { jobRunId: "noReport" };
            await expect(service.generatePdfReport(input as any)).rejects.toThrow("No discovery report found for jobRunId: noReport");
        });
    });

    describe("generateCsvReport", () => {
        it("should generate CSV and write to file", async () => {
            const fakeData = [
                { sub_category: "Config Name", value: "bar" },
                { sub_category: "Path", value: "qux" },
            ];
            const mockReport = {
                id: 1,
                jobRunId: "99",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([{ "Config Name": "bar" }])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "99" };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/99-discover-report.csv",
                expect.stringContaining("Config Name,Path")
            );
            expect(fs.createWriteStream).toHaveBeenCalledWith("/tmp/99-discover-report.zip");
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/99-discover-report.zip",
            });
        });

        it("should push value when header exists directly in entry", async () => {
            const fakeData = [{ foo: "bar" }];
            const mockReport = {
                id: 1,
                jobRunId: "555",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([{ foo: "bar" }])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "555" };
            const result = await service.generateCsvReport(input as any);
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/555-discover-report.zip",
            });
        });

        it("should handle empty grouped data", async () => {
            const mockReport = {
                id: 1,
                jobRunId: "888",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({});
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "888" };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/888-discover-report.csv",
                expect.stringContaining("")
            );
            expect(fs.createWriteStream).toHaveBeenCalledWith("/tmp/888-discover-report.zip");
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/888-discover-report.zip",
            });
        });

        it("should handle undefined values by writing empty string", async () => {
            const fakeData = [{ sub_category: "Config Name", value: undefined }];
            const mockReport = {
                id: 1,
                jobRunId: "999",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([{ "Config Name": undefined }])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "999" };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/999-discover-report.csv",
                expect.stringContaining("Config Name")
            );
            expect(fs.createWriteStream).toHaveBeenCalledWith("/tmp/999-discover-report.zip");
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/999-discover-report.zip",
            });
        });

        it("should handle CSV generation with undefined header values", async () => {
            const fakeData = [{ header1: undefined, header2: "value2" }];
            const mockReport = {
                id: 1,
                jobRunId: "undefinedTest",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify(fakeData)
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ category: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "undefinedTest" };
            const result = await service.generateCsvReport(input as any);

            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/undefinedTest-discover-report.zip",
            });
        });

        it("should throw error when no report found for CSV generation", async () => {
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(null);
            
            const input = { jobRunId: "noCsvReport" };
            await expect(service.generateCsvReport(input as any)).rejects.toThrow("No discovery report found for jobRunId: noCsvReport");
        });

        it("should handle CSV generation with sub_category matching logic", async () => {
            const fakeData = [
                { sub_category: "testCategory", value: "testValue" },
                { otherField: "otherValue" }
            ];
            const mockReport = {
                id: 1,
                jobRunId: "subCategoryTest",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify(fakeData)
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ category: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "subCategoryTest" };
            const result = await service.generateCsvReport(input as any);

            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/subCategoryTest-discover-report.zip",
            });
        });

        it("should handle CSV generation when header not found in any entry", async () => {
            const fakeData = [
                { otherField: "value1" },
                { anotherField: "value2" }
            ];
            const mockReport = {
                id: 1,
                jobRunId: "noHeaderMatch",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify(fakeData)
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ category: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "noHeaderMatch" };
            const result = await service.generateCsvReport(input as any);

            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/noHeaderMatch-discover-report.zip",
            });
        });
    });

    describe("updateJsonReport", () => {
        it("should update existing report", async () => {
            const fakeReport = { 
                id: 1, 
                jobRunId: "1", 
                reportType: ReportType.DISCOVERY, 
                reportData: JSON.stringify([{ existing: "data" }])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(fakeReport);
            (reportsRepo.save as jest.Mock).mockResolvedValue(fakeReport);
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: "1", data: [{ foo: "bar" }], updateType: 'data' as const };
            const result = await service.updateJsonReport(input as any);

            expect(reportsRepo.findOne).toHaveBeenCalledWith({
                where: { jobRunId: "1", reportType: ReportType.DISCOVERY },
            });
            expect(reportsRepo.save).toHaveBeenCalledWith(fakeReport);
            expect(result).toBe("Updated The report Data Successfully");
        });

        it("should create and save new report if not found", async () => {
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(undefined);
            const newReport = {
                jobRunId: "2",
                reportType: ReportType.DISCOVERY,
            };
            (reportsRepo.create as jest.Mock).mockReturnValue(newReport);
            (reportsRepo.save as jest.Mock).mockResolvedValue({
                ...newReport,
                reportData: JSON.stringify([{ foo: "bar" }]),
            });
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: "2", data: [{ foo: "bar" }], updateType: 'data' as const };
            const result = await service.updateJsonReport(input as any);

            expect(reportsRepo.create).toHaveBeenCalledWith({
                jobRunId: "2",
                reportType: ReportType.DISCOVERY,
            });
            expect(reportsRepo.save).toHaveBeenCalled();
            expect(result).toBe("Updated The report Data Successfully");
        });

        it("should handle case where header exists directly on entry object", async () => {
            const fakeData = [
                { "Config Name": "bar" },
                { sub_category: "Path", value: "qux" },
            ];
            const mockReport = {
                id: 1,
                jobRunId: "101",
                reportType: ReportType.DISCOVERY,
                reportData: JSON.stringify([{ "Config Name": "bar" }])
            };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(mockReport);
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { jobRunId: "101" };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/101-discover-report.csv",
                expect.stringContaining("Path")
            );
            expect(fs.createWriteStream).toHaveBeenCalledWith("/tmp/101-discover-report.zip");
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/101-discover-report.zip",
            });
        });

        it("should handle empty object as data", async () => {
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(undefined);
            const newReport = {
                jobRunId: "3",
                reportType: ReportType.DISCOVERY,
            };
            (reportsRepo.create as jest.Mock).mockReturnValue(newReport);
            (reportsRepo.save as jest.Mock).mockResolvedValue({
                ...newReport,
                reportData: JSON.stringify([]),
            });
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: "3", data: [], updateType: 'data' as const };
            const result = await service.updateJsonReport(input as any);

            expect(result).toBe("Updated The report Data Successfully");
        });

        it("should update job run status when updateType is status", async () => {
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: "4", updateType: 'status' as const };
            const result = await service.updateJsonReport(input as any);

            expect(jobRunRepo.update).toHaveBeenCalledWith({ id: "4" }, { isReportReady: true });
            expect(result).toBe("Updated The report status Successfully");
        });
    });

    describe("configService fallback", () => {
        it("should use default schema name if configService returns undefined", async () => {
            const customConfigService = {
                get: jest.fn((key: string) => {
                    if (key === "app.baseDir") return "/tmp";
                    return undefined;
                }),
            };

            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    DiscoveryReportService,
                    { provide: DataSource, useValue: { query: jest.fn().mockResolvedValue([]) } },
                    { provide: PDFGeneratorService, useClass: PDFGeneratorService },
                    { provide: ConfigService, useValue: customConfigService },
                    { provide: getRepositoryToken(ReportsEntity), useValue: {} },
                    { provide: getRepositoryToken(JobRunEntity), useValue: {} },
                    {
                        provide: ProjectIdCacheService,
                        useValue: {
                            getProjectIdFromCache: jest.fn().mockResolvedValue('project-123'),
                        },
                    },
                    {
                        provide: LoggerFactory,
                        useValue: {
                            create: jest.fn().mockReturnValue({
                                info: jest.fn(),
                                error: jest.fn(),
                                warn: jest.fn(),
                                debug: jest.fn(),
                                log: jest.fn(),
                            }),
                        },
                    },
                ],
            }).compile();

            const customService = module.get<DiscoveryReportService>(DiscoveryReportService);
            await customService.getSection({ jobRunId: 1, section: "section1" } as any);
            expect(customConfigService.get).toHaveBeenCalledWith("typeorm.schema");
        });

        it('should use fallback logger when LoggerFactory is not provided', async () => {
            const module: TestingModule = await Test.createTestingModule({
                providers: [
                    DiscoveryReportService,
                    {
                        provide: DataSource,
                        useValue: { query: jest.fn() },
                    },
                    {
                        provide: PDFGeneratorService,
                        useClass: PDFGeneratorService,
                    },
                    {
                        provide: ConfigService,
                        useValue: {
                            get: jest.fn((key: string) => {
                                if (key === "app.baseDir") return "/tmp";
                                if (key === "typeorm.schema") return "testschema";
                                return undefined;
                            }),
                        },
                    },
                    {
                        provide: getRepositoryToken(ReportsEntity),
                        useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
                    },
                    {
                        provide: getRepositoryToken(JobRunEntity),
                        useValue: { update: jest.fn() },
                    },
                    {
                        provide: ProjectIdCacheService,
                        useValue: { getProjectIdFromCache: jest.fn().mockResolvedValue('proj123') },
                    },
                    // Note: LoggerFactory is NOT provided, triggering fallback
                ],
            }).compile();

            const fallbackService = module.get<DiscoveryReportService>(DiscoveryReportService);
            expect(fallbackService).toBeDefined();
        });

        it('should handle updateJsonReport errors without stack trace', async () => {
            const mockError = new Error('Update failed');
            delete mockError.stack; // Remove stack property
            (reportsRepo.findOne as jest.Mock).mockRejectedValue(mockError);

            const input = { jobRunId: "errorTest", updateType: "data", data: [] };
            await expect(service.updateJsonReport(input as any)).rejects.toThrow(mockError);
        });

        it('should handle generateCsvReport errors without stack trace', async () => {
            const mockError = new Error('CSV generation failed');
            delete mockError.stack; // Remove stack property  
            (reportsRepo.findOne as jest.Mock).mockRejectedValue(mockError);

            const input = { jobRunId: "csvErrorTest" };
            await expect(service.generateCsvReport(input as any)).rejects.toThrow(mockError);
        });

        it('should handle generatePdfReport errors without stack trace', async () => {
            const mockError = new Error('PDF generation failed');
            delete mockError.stack; // Remove stack property
            (reportsRepo.findOne as jest.Mock).mockRejectedValue(mockError);

            const input = { jobRunId: "pdfErrorTest" };
            await expect(service.generatePdfReport(input as any)).rejects.toThrow(mockError);
        });
    });
});
