import { PDFGeneratorService } from "./pdf-generator.service";
import puppeteer, { Browser, Page, PDFOptions } from "puppeteer";

jest.mock("puppeteer");

describe("PDFGeneratorService", () => {
    let service: PDFGeneratorService;
    let mockBrowser: jest.Mocked<Browser>;
    let mockPage: jest.Mocked<Page>;

    beforeEach(() => {
        mockPage = {
            setContent: jest.fn().mockResolvedValue(undefined),
            pdf: jest.fn().mockResolvedValue(Buffer.from("pdf-content")),
            close: jest.fn().mockResolvedValue(undefined),
            isClosed: jest.fn().mockReturnValue(false),
            // @ts-ignore
            ...{},
        } as unknown as jest.Mocked<Page>;

        mockBrowser = {
            newPage: jest.fn().mockResolvedValue(mockPage),
            close: jest.fn().mockResolvedValue(undefined),
            connected: true,
            // @ts-ignore
            ...{},
        } as unknown as jest.Mocked<Browser>;

        (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);

        service = new PDFGeneratorService();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("init", () => {
        it("should launch puppeteer browser if not initialized", async () => {
            await service.init();
            expect(puppeteer.launch).toHaveBeenCalledWith({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                ],
                protocolTimeout: 60000,
            });
        });

        it("should not launch browser if already initialized", async () => {
            await service.init();
            await service.init();
            expect(puppeteer.launch).toHaveBeenCalledTimes(1);
        });
    });

    describe("getBrowser", () => {
        it("should throw if browser is not initialized", () => {
            expect(() => service.getBrowser()).toThrow(
                "Puppeteer browser is not initialized yet."
            );
        });

        it("should return browser if initialized", async () => {
            await service.init();
            expect(service.getBrowser()).toBe(mockBrowser);
        });
    });

    describe("getNewPage", () => {
        it("should return a new page from the browser", async () => {
            await service.init();
            const page = await service.getNewPage();
            expect(mockBrowser.newPage).toHaveBeenCalled();
            expect(page).toBe(mockPage);
        });
    });

    describe("generatePDF", () => {
        it("should generate a PDF buffer from HTML", async () => {
            const html = "<html><body>Hello</body></html>";
            await service.init();
            const buffer = await service.generatePDF(html);
            expect(mockPage.setContent).toHaveBeenCalledWith(html, { waitUntil: "networkidle0" });
            expect(mockPage.pdf).toHaveBeenCalledWith({
                format: "A4",
                printBackground: true,
            });
            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer.toString()).toBe("pdf-content");
            expect(mockPage.close).toHaveBeenCalled();
        });

        it("should pass custom PDFOptions", async () => {
            const html = "<html></html>";
            const options: PDFOptions = { landscape: true };
            await service.init();
            await service.generatePDF(html, options);
            expect(mockPage.pdf).toHaveBeenCalledWith(
                expect.objectContaining({ landscape: true, format: "A4", printBackground: true })
            );
        });

        it("should close the page even if setContent throws", async () => {
            mockPage.setContent.mockRejectedValueOnce(new Error("fail"));
            await service.init();
            await expect(service.generatePDF("<html></html>")).rejects.toThrow("fail");
            expect(mockPage.close).toHaveBeenCalled();
        });

        it("should not close the page if already closed", async () => {
            mockPage.isClosed.mockReturnValueOnce(true);
            await service.init();
            await service.generatePDF("<html></html>");
            expect(mockPage.close).not.toHaveBeenCalled();
        });
    });

    describe("onApplicationShutdown", () => {
        it("should close the browser if connected", async () => {
            await service.init();
            await service.onApplicationShutdown();
            expect(mockBrowser.close).toHaveBeenCalled();
        });

        it("should not close the browser if not connected", async () => {
            await service.init();
            (mockBrowser as any).connected = false;
            await service.onApplicationShutdown();
            expect(mockBrowser.close).not.toHaveBeenCalled();
        });

        it("should not throw if browser is not initialized", async () => {
            await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
        });
    });
});