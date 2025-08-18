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

jest.mock("fs");

(fs.promises as any) = {
    writeFile: jest.fn(),
}

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
            query: jest.fn().mockReturnValue("SELECT * FROM section1"),
            mapper: jest.fn().mockReturnValue([{ id: 1, name: "test" }]),
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
                            if (key === "typeorm.scheama") return "testschema";
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
            const result = await service.getSection({ jobRunId: 123, section: "section1" } as any);
            expect(dataSource.query).toHaveBeenCalledWith("SELECT * FROM section1", [123]);
            expect(result).toEqual([{ id: 1, name: "test" }]);
        });

        it("should throw if section does not exist", async () => {
            await expect(
                service.getSection({ jobRunId: 1, section: "doesnotexist" } as any)
            ).rejects.toThrow();
        });
    });

    describe("generatePdfReport", () => {
        it("should generate PDF and write to file", async () => {
            const fakeBuffer = Buffer.from("pdfdata");
            (groupAndOrder as jest.Mock).mockReturnValue({ category: [] });
            (pdfGenerator.generatePDF as jest.Mock).mockResolvedValue(fakeBuffer);
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            const input = { data: [{ foo: "bar" }], jobRunId: 42 };
            const result = await service.generatePdfReport(input as any);

            expect(groupAndOrder).toHaveBeenCalledWith(input.data, ReportType.DISCOVERY);
            expect(pdfGenerator.generatePDF).toHaveBeenCalledWith({
                data: { category: [] },
                template: PDFTemplate.DISCOVERY_REPORT,
            });
            expect(fs.promises.writeFile).toHaveBeenCalledWith("/tmp/42-discover-report.pdf", fakeBuffer);
            expect(result).toEqual({
                message: "PDF report generated successfully",
                path: "/tmp/42-discover-report.pdf",
            });
        });

        it("should throw if PDF generation fails", async () => {
            (groupAndOrder as jest.Mock).mockReturnValue({ category: [] });
            (pdfGenerator.generatePDF as jest.Mock).mockRejectedValue(new Error("fail"));

            const input = { data: [], jobRunId: 777 };
            await expect(service.generatePdfReport(input as any)).rejects.toThrow("fail");
        });
    });

    describe("generateCsvReport", () => {
        it("should generate CSV and write to file", async () => {
            const fakeData = [
                { sub_category: "foo", value: "bar" },
                { sub_category: "baz", value: "qux" },
            ];
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { data: [{ foo: "bar" }], jobRunId: 99 };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/99-discover-report.csv",
                expect.stringContaining("foo,baz")
            );
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/99-discover-report.csv",
            });
        });

        it("should push value when header exists directly in entry", async () => {
            const fakeData = [{ foo: "bar" }];
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { data: [{ foo: "bar" }], jobRunId: 555 };
            const result = await service.generateCsvReport(input as any);
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/555-discover-report.csv",
            });
        });

        it("should handle empty grouped data", async () => {
            (groupAndOrder as jest.Mock).mockReturnValue({});
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { data: [], jobRunId: 888 };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/888-discover-report.csv",
                expect.stringContaining("")
            );
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/888-discover-report.csv",
            });
        });

        it("should handle undefined values by writing empty string", async () => {
            const fakeData = [{ sub_category: "foo", value: undefined }];
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { data: [{ foo: undefined }], jobRunId: 999 };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/999-discover-report.csv",
                expect.stringContaining("foo")
            );
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/999-discover-report.csv",
            });
        });
    });

    describe("updateJsonReport", () => {
        it("should update existing report", async () => {
            const fakeReport = { id: 1, jobRunId: 1, reportType: ReportType.DISCOVERY, reportData: "{}" };
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(fakeReport);
            (reportsRepo.save as jest.Mock).mockResolvedValue(fakeReport);
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: 1, data: { foo: "bar" } };
            const result = await service.updateJsonReport(input as any);

            expect(reportsRepo.findOne).toHaveBeenCalledWith({
                where: { jobRunId: 1, reportType: ReportType.DISCOVERY },
            });
            expect(reportsRepo.save).toHaveBeenCalledWith(fakeReport);
            expect(jobRunRepo.update).toHaveBeenCalledWith({ id: 1 }, { isReportReady: true });
            expect(result).toBe(fakeReport);
        });

        it("should create and save new report if not found", async () => {
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(undefined);
            (reportsRepo.create as jest.Mock).mockReturnValue({
                jobRunId: 2,
                reportType: ReportType.DISCOVERY,
                reportData: '{"foo":"bar"}',
            });
            (reportsRepo.save as jest.Mock).mockResolvedValue({
                jobRunId: 2,
                reportType: ReportType.DISCOVERY,
                reportData: '{"foo":"bar"}',
            });
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: 2, data: { foo: "bar" } };
            const result = await service.updateJsonReport(input as any);

            expect(reportsRepo.create).toHaveBeenCalledWith({
                jobRunId: 2,
                reportType: ReportType.DISCOVERY,
                reportData: '{"foo":"bar"}',
            });
            expect(reportsRepo.save).toHaveBeenCalled();
            expect(jobRunRepo.update).toHaveBeenCalledWith({ id: 2 }, { isReportReady: true });
            expect(result).toEqual({
                jobRunId: 2,
                reportType: ReportType.DISCOVERY,
                reportData: '{"foo":"bar"}',
            });
        });

        it("should handle case where header exists directly on entry object", async () => {
            const fakeData = [
                { foo: "bar" },
                { sub_category: "baz", value: "qux" },
            ];
            (groupAndOrder as jest.Mock).mockReturnValue({ a: fakeData });
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
            (escapeCsvValue as jest.Mock).mockImplementation((v) => v);

            const input = { data: [{ foo: "bar" }], jobRunId: 101 };
            const result = await service.generateCsvReport(input as any);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "/tmp/101-discover-report.csv",
                expect.stringContaining("baz")
            );
            expect(result).toEqual({
                message: "CSV report generated successfully",
                path: "/tmp/101-discover-report.csv",
            });
        });

        it("should handle empty object as data", async () => {
            (reportsRepo.findOne as jest.Mock).mockResolvedValue(undefined);
            (reportsRepo.create as jest.Mock).mockReturnValue({
                jobRunId: 3,
                reportType: ReportType.DISCOVERY,
                reportData: "{}",
            });
            (reportsRepo.save as jest.Mock).mockResolvedValue({
                jobRunId: 3,
                reportType: ReportType.DISCOVERY,
                reportData: "{}",
            });
            (jobRunRepo.update as jest.Mock).mockResolvedValue(undefined);

            const input = { jobRunId: 3, data: {} };
            const result = await service.updateJsonReport(input as any);

            expect(result).toEqual({
                jobRunId: 3,
                reportType: ReportType.DISCOVERY,
                reportData: "{}",
            });
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
                ],
            }).compile();

            const customService = module.get<DiscoveryReportService>(DiscoveryReportService);
            await customService.getSection({ jobRunId: 1, section: "section1" } as any);
            expect(customConfigService.get).toHaveBeenCalledWith("typeorm.scheama");
        });
    });
});
