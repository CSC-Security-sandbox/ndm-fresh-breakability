import { Test, TestingModule } from '@nestjs/testing';
import { PdfService } from './pdf.service';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';

describe('PdfService', () => {
  let pdfService: PdfService;
  let mockInventoryRepo;
  let mockReportsRepo;

  

  beforeEach(async () => {
    mockInventoryRepo = {
      query: jest.fn()
    };

    mockReportsRepo = {
      find: jest.fn()
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
      PdfService,
      {
        provide: getRepositoryToken(InventoryEntity),
        useValue: mockInventoryRepo,
      },
      {
        provide: getRepositoryToken(ReportsEntity),
        useValue: mockReportsRepo,
      },
      ],
    }).compile();

    pdfService = module.get<PdfService>(PdfService);
  });

  describe('generatePdf', () => {
    it('should generate a PDF buffer', async () => {
      // Mock the necessary dependencies and setup the test data
      const jobRunId = '123';
      const reportType = 'DISCOVERY';
      const latestReport = new ReportsEntity();
      latestReport.reportData = JSON.stringify([
        { category: 'Category 1', sub_category: 'Sub Category 1', count_or_space: 10 },
        { category: 'Category 1', sub_category: 'Sub Category 2', count_or_space: 20 },
        { category: 'Category 2', sub_category: 'Sub Category 1', count_or_space: 30 },
      ]);
      jest.spyOn(mockReportsRepo, 'find').mockResolvedValueOnce([latestReport]);
      const result = await pdfService.generatePdf(jobRunId, reportType);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('generateHtmlTable', () => {
    it('should generate the HTML table correctly', () => {
      const data = [
        { category: 'Category 1', sub_category: 'Sub Category 1', value: 10 },
        { category: 'Category 1', sub_category: 'Sub Category 2', value: 20 },
        { category: 'Category 2', sub_category: 'Sub Category 1', value: 30 },
      ];
      const expectedHtml = `
         <html>
        <head>
        <style>
          table {
            border-collapse: collapse;
            width: 100%;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: left;
            }
            th {
              background-color: #f2f2f2;
            }
            tr:nth-child(even) {
              background-color: #f9f9f9;
            }
            tr:hover {
              background-color: #ddd;
            }
          </style>
        </head>
        <body>
          <h1>Data Summary</h1>
          <h2>Category 1</h2>
          <table>
            <tr>
              <th>Sub Category</th>
              <th>Count or Space</th>
            </tr>
            <tr>
              <td>Sub Category 1</td>
              <td>10</td>
            </tr>
            <tr>
              <td>Sub Category 2</td>
              <td>20</td>
            </tr>
          </table>
          <h2>Category 2</h2>
          <table>
            <tr>
              <th>Sub Category</th>
              <th>Count or Space</th>
            </tr>
            <tr>
              <td>Sub Category 1</td>
              <td>30</td>
            </tr>
          </table>
        </body>
        </html>
      `;
      const generatedHtml = pdfService.generateHtmlTable(data);
      expect(normalizeHtml(generatedHtml)).toEqual(normalizeHtml(expectedHtml));
    });
  });
});

function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ') 
    .trim();             
}
