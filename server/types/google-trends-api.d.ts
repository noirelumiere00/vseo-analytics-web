declare module "google-trends-api" {
  interface TrendsOptions {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
  }

  function interestOverTime(options: TrendsOptions): Promise<string>;

  export { interestOverTime, TrendsOptions };
}
