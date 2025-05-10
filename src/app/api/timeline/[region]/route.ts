// src/app/api/timeline/[region]/route.ts

import { type NextRequest, NextResponse } from 'next/server';
// KVやwaitUntilを使う場合は、@cloudflare/workers-types から型をインポートすると良いでしょう
// import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';

// --- 型定義 ---

/**
 * Mastodon のステータス（トゥート）を表す型定義。
 * API レスポンスに合わせて調整してください。
 */
interface MastodonStatus {
    id: string;
    created_at: string; // ISO 8601 形式の文字列
    content: string;    // HTML 形式のコンテンツ文字列
    url: string;        // Mastodon上の投稿へのURL
    account: {
        acct: string;   // ユーザーアカウント (例: user@instance.domain)
    };
    instance_domain?: string; // どのインスタンスからの投稿かを示すドメイン (後で追加)
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
interface TimelineApiResponse {
    timeline: MastodonStatus[];
    sentimentAnalysis: SentimentAnalysisData;
}

/**
 * /api/analyze-sentiment Pages Function から返されるレスポンスの期待される型。
 */
interface AnalyzeSentimentFunctionResponse {
    sentimentResults: ({
        originalTextIndex: number; // 元のテキスト配列のインデックスを保持する場合
        label: string;             // 例: "POSITIVE", "NEGATIVE", "LABEL_0", "LABEL_1"
        score: number;             // 信頼度スコア
    } | null)[]; // エラーや分析対象外の場合は null を含む配列
}


// --- ヘルパー関数 ---

/**
 * HTML タグを除去し、基本的なエンティティをデコードする簡単な関数。
 */
const stripHtml = (html: string): string => {
    if (!html) return '';
    // <p> と <br> をスペースに置換
    let text = html.replace(/<p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    // 残りのHTMLタグを除去
    text = text.replace(/<[^>]*>/g, '');
    // 基本的なHTMLエンティティをデコード
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    // 連続するスペースを一つにまとめ、前後の空白をトリム
    return text.replace(/\s+/g, ' ').trim();
};

// --- API ルートハンドラ ---

export const runtime = 'edge'; // Cloudflare Edge Runtime で実行することを指定

// GET関数の型定義。第2引数はNext.js App Routerの規約に従う。
// KVやwaitUntilを使う場合は、適切な型で context を受け取る必要がある。
// 例: context: EventContext<Env, string, Record<string, unknown>> (Envはバインディング型)
export async function GET(
  request: NextRequest,
  { params }: { params: { region: string } }
  // context?: ExecutionContext & { env: { TIMELINE_CACHE?: KVNamespace } } // KVを使う場合の例
) {
  const region = params.region.toUpperCase();
  console.log(`API Route /api/timeline/${region} called`);

  // --- 1. 環境変数 (Regions JSON) の取得と検証 ---
  const regionsJsonString = process.env.REGIONS_JSON; // Cloudflare Pagesの環境変数
  let regionConfig: Record<string, string> = {};

  if (typeof regionsJsonString !== 'string' || regionsJsonString === '') {
     console.error(`[${region}] Environment variable REGIONS_JSON is not set or empty.`);
     return NextResponse.json({ error: 'Server configuration error: REGIONS_JSON missing or empty' }, { status: 500 });
  }

  try {
     regionConfig = JSON.parse(regionsJsonString);
     console.log(`[${region}] Region Config loaded: ${Object.keys(regionConfig).join(', ')}`);
   } catch (e) {
     console.error(`[${region}] Failed to parse REGIONS_JSON:`, e);
     return NextResponse.json({ error: 'Server configuration error: REGIONS_JSON invalid format' }, { status: 500 });
   }

  // --- 2. インスタンスリストの取得と検証 ---
  const instancesString: string | undefined = regionConfig[region];

  if (instancesString === undefined || instancesString === null || instancesString === '') {
      console.error(`[${region}] No instances configured or empty string for region.`);
      return NextResponse.json({ error: `No instances configured for region: ${region}` }, { status: 404 });
  }
  const instanceDomains: string[] = instancesString.split(',')
                                      .map(domain => domain.trim())
                                      .filter(Boolean); // 空のドメインを除外
  if (instanceDomains.length === 0) {
    console.error(`[${region}] No valid instance domains found after parsing.`);
    return NextResponse.json({ error: `No valid instances found for region: ${region}` }, { status: 400 });
  }
  console.log(`[${region}] Target instance domains:`, instanceDomains);


  // --- 3. KVキャッシュ確認 (将来的に実装する場合) ---
  // const kv = context?.env?.TIMELINE_CACHE;
  // const cacheKey = `timeline-response:${region}`;
  // if (kv) {
  //   try {
  //     const cachedDataString = await kv.get(cacheKey);
  //     if (cachedDataString) {
  //        console.log(`[${region}] Cache hit for response.`);
  //        const cachedResponse: TimelineApiResponse = JSON.parse(cachedDataString);
  //        return NextResponse.json(cachedResponse);
  //      }
  //     console.log(`[${region}] Cache miss for response.`);
  //   } catch (e) { console.error(`[${region}] KV Cache read error:`, e); }
  // }


  // --- 4. Mastodon API から投稿データを取得 ---
  const fetchPromises: Promise<MastodonStatus[]>[] = instanceDomains.map(async (domain: string): Promise<MastodonStatus[]> => {
    const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
    console.log(`[${region}] Fetching from Mastodon API: ${url}`);
    try {
      const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          // AbortController for timeout (optional but recommended for external API calls)
          // signal: AbortSignal.timeout(5000) // e.g., 5 seconds timeout
      });
      if (!response.ok) {
        console.error(`[${region}] Failed to fetch from ${domain}: ${response.status} ${response.statusText}`);
        return [];
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
          console.error(`[${region}] Received non-JSON response from ${domain}: ${contentType}`);
          return [];
      }
      const statuses = await response.json() as MastodonStatus[];
      return statuses.map(status => ({ ...status, instance_domain: domain }));
    } catch (error) {
      console.error(`[${region}] Network or other error fetching from ${domain}:`, error);
      return [];
    }
  });

  // --- 5. 取得した投稿データの集計と整形 ---
  let combinedStatuses: MastodonStatus[] = [];
  try {
      const results = await Promise.all(fetchPromises);
      combinedStatuses = results.flat();
      combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      combinedStatuses = combinedStatuses.slice(0, 50); // 最大50件に制限
      console.log(`[${region}] Fetched ${combinedStatuses.length} statuses in total.`);
  } catch (error) {
      console.error(`[${region}] Error processing Mastodon API fetch results:`, error);
      return NextResponse.json({ error: 'Failed to process Mastodon API results' }, { status: 500 });
  }

  // --- 6. 感情分析 (別の Pages Function を呼び出す) ---
  let sentimentAnalysis: SentimentAnalysisData = { // デフォルト/エラー時の値
      positivePercentage: 0, negativePercentage: 0, neutralPercentage: 0,
      totalAnalyzed: 0, counts: { positive: 0, negative: 0, neutral: 0 }
  };

  if (combinedStatuses.length > 0) {
      try {
          const textsToAnalyze = combinedStatuses.map(status => stripHtml(status.content));

          // 現在のリクエストURLのオリジンを元に、analyze-sentiment APIの絶対URLを構築
          const baseAnalyzeApiUrl = new URL(request.url);
          const analyzeApiUrl = `${baseAnalyzeApiUrl.origin}/api/analyze-sentiment`;

          console.log(`[${region}] Calling sentiment analysis Function: ${analyzeApiUrl} with ${textsToAnalyze.length} texts.`);

          const analyzeResponse = await fetch(analyzeApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: textsToAnalyze })
          });

          if (!analyzeResponse.ok) {
              console.error(`[${region}] Sentiment analysis Function call failed: ${analyzeResponse.status} ${analyzeResponse.statusText}`);
              const errorBody = await analyzeResponse.text().catch(() => 'Could not read error from sentiment Function');
              console.error(`[${region}] Sentiment Function error body: ${errorBody}`);
              // エラー時はデフォルトの sentimentAnalysis を使用 (上で初期化済み)
          } else {
              const analyzeResult = await analyzeResponse.json() as AnalyzeSentimentFunctionResponse;
              console.log(`[${region}] Received from sentiment Function: ${analyzeResult?.sentimentResults?.length ?? 0} results.`);

              let sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
              let totalAnalyzed = 0;
              if (analyzeResult && Array.isArray(analyzeResult.sentimentResults)) {
                  analyzeResult.sentimentResults.forEach(res => {
                      if (res) { // null でない結果のみ処理
                          const label = res.label.toUpperCase();
                          if (label.includes("POSITIVE") || label === 'LABEL_1') sentimentCounts.positive++;
                          else if (label.includes("NEGATIVE") || label === 'LABEL_0') sentimentCounts.negative++;
                          else sentimentCounts.neutral++;
                          totalAnalyzed++;
                      }
                  });
              }

              sentimentAnalysis = {
                  positivePercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.positive / totalAnalyzed) * 100) : 0,
                  negativePercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.negative / totalAnalyzed) * 100) : 0,
                  neutralPercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.neutral / totalAnalyzed) * 100) : 0,
                  totalAnalyzed: totalAnalyzed,
                  counts: sentimentCounts
              };
              console.log(`[${region}] Sentiment analysis aggregation successful:`, sentimentAnalysis);
          }
      } catch (e) {
          console.error(`[${region}] Error calling or processing result from sentiment analysis Function:`, e);
          // エラー時はデフォルトの sentimentAnalysis を使用
      }
  } else {
      console.log(`[${region}] No statuses fetched for timeline, skipping sentiment analysis.`);
  }

  // --- 7. KVキャッシュへの書き込み (将来的に実装する場合) ---
  // const kv = context?.env?.TIMELINE_CACHE;
  // if (kv) {
  //    const responsePayloadToCache: TimelineApiResponse = { timeline: combinedStatuses, sentimentAnalysis };
  //    const responseBodyToCache = JSON.stringify(responsePayloadToCache);
  //    // context?.waitUntil(kv.put(cacheKey, responseBodyToCache, { expirationTtl: 300 })...);
  //    // console.log(`[${region}] Attempted to cache response.`);
  // }

  // --- 8. 最終的なレスポンスを返す ---
  const responsePayload: TimelineApiResponse = {
      timeline: combinedStatuses,
      sentimentAnalysis: sentimentAnalysis
  };

  console.log(`[${region}] Sending response with ${combinedStatuses.length} timeline items and sentiment.`);
  return NextResponse.json(responsePayload);
}