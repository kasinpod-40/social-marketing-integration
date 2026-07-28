import { D1OrganicReportSource } from '../d1-organic-report-source.js';

/**
 * Backward-compatible TikTok facade over the shared D1 Organic reader.
 * Legacy report code keeps its historical readSummary field names while query logic is shared.
 */
export class D1TikTokOrganicReportSource {
  constructor(input = {}) {
    this.source = new D1OrganicReportSource({
      db: input.db,
      platform: 'tiktok',
      datasetKey: 'organic_content_cumulative',
    });
  }

  async load(input = {}) {
    const result = await this.source.load(input);
    const readSummary = result.readSummary;
    return Object.freeze({
      contents: result.contents,
      dailySnapshots: result.dailySnapshots,
      readSummary: Object.freeze({
        ...readSummary,
        strategy: 'd1_observation_range',
        dailySnapshotRecords: result.dailySnapshots.length,
        externalContentIds: result.contents.length,
        contentQueries: 1,
        dailyQueries: input.compareEnd ? 3 : 2,
        coverageQueries: readSummary.coverageRunId ? 2 : 1,
        fallbackRowsScanned: 0,
      }),
    });
  }
}
