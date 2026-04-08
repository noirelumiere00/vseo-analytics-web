export interface ProductionBrief {
  appealAxes: Array<{
    type: string;
    titleIdea: string;
    captionTemplate: {
      hook: string;
      empathy: string;
      product: string;
      benefit: string;
      cta: string;
    };
    rationale: string;
  }>;
  hashtagSets: string[][];
  shootingChecklist: Array<{
    recommendation: string;
    source: string;
  }>;
  ngList: Array<{
    item: string;
    reason: string;
    evidence: string;
  }>;
  postingSchedule: {
    top3: Array<{ day: string; hour: number; reason: string }>;
    avoid: Array<{ day: string; hour: number; reason: string }>;
  };
}
