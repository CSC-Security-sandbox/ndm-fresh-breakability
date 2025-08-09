import { Injectable } from '@nestjs/common';
import { createCsvString } from '../utils/config-data-csv-generation.utils';

@Injectable()
export class CsvGeneratorService {
  createServicePodsCsvContent(servicePods: any[]): string {
    if (servicePods.length === 0) return '';
    const headers = ['Namespace', 'Pod', 'Status', 'Timestamp'];
    return createCsvString(headers, servicePods);
  }

  createMetricsCsvContent(metrics: any[]): string {
    if (metrics.length === 0) return '';
    const headers = ['Name', 'Timestamp', 'Usage'];
    return createCsvString(headers, metrics);
  }

  createBuildDetailsCsvContent(buildDetails: any[]): string {
    if (buildDetails.length === 0) return '';
    const headers = [
      'Pod',
      'Build Version',
      'Platform',
      'Worker Id',
      'Timestamp',
    ];
    return createCsvString(headers, buildDetails);
  }
}
