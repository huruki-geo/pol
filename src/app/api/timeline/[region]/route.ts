// src/app/api/timeline/[region]/route.ts

import { type NextRequest, NextResponse } from 'next/server';

// --- 型定義 ---

/**
 * Mastodon のステータス（トゥート）を表す型定義。
 */
interface MastodonStatus {
    id: string;
    created_at: string;
    content: string;
    url: string;
    account: {
        acct: string;
    };
    instance_domain?: string;
}

/**
 * 感情分析の集計結果の型。
 */
interface SentimentAnalysisData {
    positivePercentage: number;
    negativePercentage: number;
    neutralPercentage: number;
    totalAnalyzed: number;
    counts: { positive: number; negative: number; neutral: number };
}

/**
 * このAPIルートのレスポンス全体の型。
 */
interface ApiResponse {
    timeline: MastodonStatus[];
    sentimentAnalysis: SentimentAnalysisData;
}

/**
 * /api/analyze-sentiment から返されるレスポンスの期待される型。
 */
interface AnalyzeSentimentApiResponse {
    sentimentResults: ({ originalText: string; label: string; score: number } | null)[];
}


// --- ヘルパー関数 ---

/**
 * HTML タグを除去する簡単な関数。
 */
const stripHtml = (html: string): string => {
    if (!html) return '';
    let text = html.replace(/<p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    return text.replace(/\s+/g, ' ').trim();
};

// --- API ルートハンドラ ---

export const runtime = 'edge'; // Edge Runtime で実行することを指定

export async function GET(
  request: NextRequest,
  context: any
  // context?: ExecutionContext // KVなど Pages Function Context が必要な場合
) {
  if (
    !context ||
    typeof context !== 'object' ||
    !context.params ||
    typeof context.params !== 'object' ||
    typeof context.params.region !== 'string'
  ) {
    console.error("Invalid context or params object received:", context);
    return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
  }

  const region = context.params.region.toUpperCase();
  console.log(`API Route /api/timeline/${region} called`);

  // --- 環境変数 (Regions JSON) の取得と検証 ---
  const regionsJsonString = process.env.REGIONS_JSON;
  let regionConfig: Record<string, string> = {};

  if (typeof regionsJsonString !== 'string' || regionsJsonString === '') {
     console.error("Environment variable REGIONS_JSON is not set or empty.");
     return NextResponse.json({ error: 'Server configuration error (regions missing)' }, { status: 500 });
  }

  try {
     regionConfig = JSON.parse(regionsJsonString);
     console.log('Region Config loaded:', JSON.stringify(regionConfig).substring(0, 100) + "..."); // 長すぎる場合は一部表示
   } catch (e) {
     console.error("Failed to parse REGIONS_JSON:", e);
     return NextResponse.json({ error: 'Server configuration error (regions invalid)' }, { status: 500 });
   }

  // --- インスタンスリストの取得と検証 ---
  const instancesString: string | undefined = regionConfig[region];

  if (instancesString === undefined || instancesString === null || instancesString === '') {
      console.error(`No instances configured or empty string for region: ${region}`);
      return NextResponse.json({ error: `No instances configured for region: ${region}` }, { status: 404 });
  }
  const instanceDomains: string[] = instancesString.split(',').map(domain => domain.trim()).filter(Boolean);
  if (instanceDomains.length === 0) {
    return NextResponse.json({ error: `No valid instances found for region: ${region}` }, { status: 400 });
  }
  console.log(`Target instance domains for ${region}:`, instanceDomains);


  // --- KVキャッシュ確認 (実装する場合はここにロジック追加) ---
  // const kv = context?.env?.TIMELINE_CACHE;
  // const cacheKey = `timeline-response:${region}`; // キャッシュキーにレスポンス全体を含むことを示す
  // if (kv) {
  //   try {
  //     const cachedDataString = await kv.get(cacheKey);
  //     if (cachedDataString) {
  //        console.log(`Cache hit for ${region} response`);
  //        const cachedResponse: ApiResponse = JSON.parse(cachedDataString);
  //        return NextResponse.json(cachedResponse);
  //      }
  //     console.log(`Cache miss for ${region} response`);
  //   } catch (e) { console.error("KV Cache read error:", e); }
  // }


  // --- Mastodon API 呼び出し ---
  const fetchPromises: Promise<MastodonStatus[]>[] = instanceDomains.map(async (domain: string): Promise<MastodonStatus[]> => {
    const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
    console.log(`Fetching from Mastodon API: ${url}`);
    try {
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!response.ok) {
        console.error(`Failed to fetch from ${domain}: ${response.status} ${response.statusText}`);
        return [];
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
          console.error(`Received non-JSON response from ${domain}: ${contentType}`);
          return [];
      }
      const statuses = await response.json() as MastodonStatus[];
      return statuses.map(status => ({ ...status, instance_domain: domain }));
    } catch (error) {
      console.error(`Error fetching from ${domain}:`, error);
      return [];
    }
  });

  // --- 結果の集計と整形 ---
  let combinedStatuses: MastodonStatus[] = [];
  try {
      const results = await Promise.all(fetchPromises);
      combinedStatuses = results.flat();
      combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      combinedStatuses = combinedStatuses.slice(0, 50); // 分析対象も最大50件
      console.log(`Fetched ${combinedStatuses.length} statuses for region ${region}`);
  } catch (error) {
      console.error('Error processing Mastodon API fetch results:', error);
      // この時点でエラーなら、感情分析は行わずにエラーを返すか、空の分析結果で続行
      return NextResponse.json({ error: 'Failed to process Mastodon API results' }, { status: 500 });
  }

  // --- 感情分析処理 (別の Pages Function を呼び出す) ---
  let sentimentAnalysis: SentimentAnalysisData = { // デフォルト/エラー時の値
      positivePercentage: 0, negativePercentage: 0, neutralPercentage: 0,
      totalAnalyzed: 0, counts: { positive: 0, negative: 0, neutral: 0 }
  };

  if (combinedStatuses.length > 0) {
      try {
          const textsToAnalyze = combinedStatuses.map(status => stripHtml(status.content));
          // 現在のリクエストURLをベースに、sentiment API の絶対URLを構築
          const baseAnalyzeApiUrl = new URL(request.url); // 現在のリクエストURLを取得
          const analyzeApiUrl = `${baseAnalyzeApiUrl.origin}/api/analyze-sentiment`; // オリジン + パス

          console.log(`Calling sentiment analysis API: ${analyzeApiUrl}`);

          const analyzeResponse = await fetch(analyzeApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: textsToAnalyze })
          });

          if (!analyzeResponse.ok) {
              console.error(`Sentiment analysis API call failed: ${analyzeResponse.status} ${analyzeResponse.statusText}`);
              const errorBody = await analyzeResponse.text().catch(() => 'Could not read sentiment API error body');
              console.error(`Sentiment API error body: ${errorBody}`);
              // エラー時はデフォルトの sentimentAnalysis を使用 (上で初期化済み)
          } else {
              const analyzeResult = await analyzeResponse.json() as AnalyzeSentimentApiResponse;

              let sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
              let totalAnalyzed = 0;
              analyzeResult.sentimentResults.forEach(res => {
                  if (res) {
                      const label = res.label.toUpperCase();
                      if (label.includes("POSITIVE") || label === 'LABEL_1') sentimentCounts.positive++;
                      else if (label.includes("NEGATIVE") || label === 'LABEL_0') sentimentCounts.negative++;
                      else sentimentCounts.neutral++;
                      totalAnalyzed++;
                  }
              });

              sentimentAnalysis = {
                  positivePercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.positive / totalAnalyzed) * 100) : 0,
                  negativePercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.negative / totalAnalyzed) * 100) : 0,
                  neutralPercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.neutral / totalAnalyzed) * 100) : 0,
                  totalAnalyzed: totalAnalyzed,
                  counts: sentimentCounts
              };
              console.log("Sentiment analysis successful via API call:", sentimentAnalysis);
          }
      } catch (e) {
          console.error("Error calling or processing sentiment analysis API:", e);
          // エラー時はデフォルトの sentimentAnalysis を使用 (上で初期化済み)
      }
  } else {
      console.log("No statuses fetched, skipping sentiment analysis.");
  }

  // --- KVキャッシュへの書き込み (実装する場合はここにロジック追加) ---
  // if (kv) {
  //    const responsePayloadToCache: ApiResponse = { timeline: combinedStatuses, sentimentAnalysis };
  //    const responseBodyToCache = JSON.stringify(responsePayloadToCache);
  //    context?.waitUntil(kv.put(cacheKey, responseBodyToCache, { expirationTtl: 300 }).catch(e => console.error("KV write error:", e)));
  //    console.log(`Attempted to cache response for region ${region}`);
  // }

  // --- 最終的な結果を JSON レスポンスとして返す ---
  const responsePayload: ApiResponse = {
      timeline: combinedStatuses,
      sentimentAnalysis: sentimentAnalysis
  };

  return NextResponse.json(responsePayload);
}