// src/app/api/timeline/[region]/route.ts

import { type NextRequest, NextResponse } from 'next/server';

// --- 型定義 ---

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REGIONS_JSON?: string;
    }
  }
}

interface MastodonStatus {
  id: string;
  created_at: string;
  content: string;
  url: string;
  account: { acct: string };
  instance_domain?: string;
}

interface AiTextClassificationInput {
  text: string;
}

interface AiTextClassificationOutput {
  label: string;
  score: number;
}

interface SentimentAnalysisData {
  positivePercentage: number;
  negativePercentage: number;
  neutralPercentage: number;
  totalAnalyzed: number;
  counts: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

interface ApiResponse {
  timeline: MastodonStatus[];
  sentimentAnalysis: SentimentAnalysisData;
}

// --- ヘルパー関数 ---

const stripHtml = (html: string): string => {
  if (!html) return '';
  let text = html.replace(/<p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<[^>]*>/g, '');
  return text.replace(/\s+/g, ' ').trim();
};

// --- API ルートハンドラ ---

export const runtime = 'edge';

export async function GET(
  request: NextRequest,
  context: {
    params: { region?: string };
    env?: {
      AI?: {
        run: (
          model: string,
          inputs: AiTextClassificationInput
        ) => Promise<AiTextClassificationOutput[]>;
      };
      TIMELINE_CACHE?: {
        get: (key: string) => Promise<string | null>;
        put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
      };
    };
    waitUntil?: (promise: Promise<any>) => void;
  }
) {
  const region = context.params?.region?.toUpperCase();
  if (!region) {
    return NextResponse.json({ error: 'Region parameter missing' }, { status: 400 });
  }

  const regionsJson = process.env.REGIONS_JSON;
  if (!regionsJson) {
    return NextResponse.json({ error: 'Server misconfiguration: REGIONS_JSON not set' }, { status: 500 });
  }

  let regionConfig: Record<string, string>;
  try {
    regionConfig = JSON.parse(regionsJson);
  } catch (err) {
    return NextResponse.json({ error: 'REGIONS_JSON is invalid JSON' }, { status: 500 });
  }

  const instancesString = regionConfig[region];
  if (!instancesString) {
    return NextResponse.json({ error: `No instance config for region: ${region}` }, { status: 404 });
  }

  const instanceDomains = instancesString
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (instanceDomains.length === 0) {
    return NextResponse.json({ error: `Empty instance list for region: ${region}` }, { status: 400 });
  }

  const fetchPromises = instanceDomains.map(async domain => {
    const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return [];
      const statuses = (await res.json()) as MastodonStatus[];
      return statuses.map(status => ({ ...status, instance_domain: domain }));
    } catch (e) {
      console.error(`Failed to fetch from ${domain}`, e);
      return [];
    }
  });

  const fetched = await Promise.all(fetchPromises);
  let combinedStatuses = fetched.flat()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50);

  const ai = context.env?.AI;
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  let totalAnalyzed = 0;

  if (ai) {
    const model = '@cf/huggingface/distilbert-sst-2-int8';
    const analysis = await Promise.all(
      combinedStatuses.map(async status => {
        const cleanText = stripHtml(status.content);
        if (cleanText.length < 10 || cleanText.length > 500) return null;

        try {
          const results = await ai.run(model, { text: cleanText });
          if (!results || results.length === 0) return null;
          const top = results.reduce((a, b) => (a.score > b.score ? a : b));
          const label = top.label.toUpperCase();
          if (label.includes('POSITIVE') || label === 'LABEL_1') return 'positive';
          if (label.includes('NEGATIVE') || label === 'LABEL_0') return 'negative';
          return 'neutral';
        } catch (e) {
          console.error(`AI error for status ${status.id}:`, e);
          return null;
        }
      })
    );

    for (const label of analysis) {
      if (label) {
        sentimentCounts[label as keyof typeof sentimentCounts]++;
        totalAnalyzed++;
      }
    }
  } else {
    console.warn('AI binding not available');
  }

  const sentimentAnalysis: SentimentAnalysisData = {
    positivePercentage: totalAnalyzed ? Math.round((sentimentCounts.positive / totalAnalyzed) * 100) : 0,
    negativePercentage: totalAnalyzed ? Math.round((sentimentCounts.negative / totalAnalyzed) * 100) : 0,
    neutralPercentage: totalAnalyzed ? Math.round((sentimentCounts.neutral / totalAnalyzed) * 100) : 0,
    totalAnalyzed,
    counts: sentimentCounts
  };

  return NextResponse.json({
    timeline: combinedStatuses,
    sentimentAnalysis
  } satisfies ApiResponse);
}
