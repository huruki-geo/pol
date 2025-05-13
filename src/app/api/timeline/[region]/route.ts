// src/app/api/timeline/[region]/route.ts

import { type NextRequest, NextResponse } from 'next/server';

// Cloudflare のランタイムコンテキストを取得するためのヘルパー
// ★★★ インポートパスは @cloudflare/next-on-pages のバージョンやドキュメントで要確認 ★★★
import { getRequestContext } from '@cloudflare/next-on-pages';
// import { getContext } from '@cloudflare/next-on-pages'; // こちらの可能性も？

// Cloudflare Workers の型 (サービスバインディングやKV、waitUntilで必要)
import type { Fetcher, KVNamespace, ExecutionContext } from '@cloudflare/workers-types';

// --- 型定義 ---

/** Mastodon のステータス（トゥート）を表す型 */
interface MastodonStatus {
    id: string;
    created_at: string;
    content: string;
    url: string;
    account: { acct: string; };
    instance_domain?: string;
}

/** 感情分析の集計結果の型 */
interface SentimentAnalysisData {
    positivePercentage: number;
    negativePercentage: number;
    neutralPercentage: number;
    totalAnalyzed: number;
    counts: { positive: number; negative: number; neutral: number };
}

/** このAPIルートのレスポンス全体の型 */
interface TimelineApiResponse {
    timeline: MastodonStatus[];
    sentimentAnalysis: SentimentAnalysisData;
}

/** AI分析サービス (pol-ai-analyzer Worker) から返されるレスポンスの期待される型 */
interface AnalyzeSentimentServiceResponse {
    sentimentResults: ({
        originalTextIndex: number;
        label: string;
        score: number;
    } | null)[];
}

/** Cloudflare の env オブジェクトの型定義 (バインディングを含む) */
interface CloudflareEnv {
    REGIONS_JSON?: string;         // 通常の環境変数
    AI_ANALYZER_SERVICE?: Fetcher; // サービスバインディング
    TIMELINE_CACHE?: KVNamespace;  // KV バインディング
    // 他のバインディング (D1, R2 など)
}

// --- ヘルパー関数 ---
const stripHtml = (html: string): string => {
    if (!html) return '';
    let text = html.replace(/<p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    return text.replace(/\s+/g, ' ').trim();
};

// --- API ルートハンドラ ---
export const runtime = 'edge'; // Edge Runtime で実行

export async function GET(
  request: NextRequest, // Next.js が提供するリクエストオブジェクト
  // Next.js App Router の context は params を含む
  contextFromNext: { params: { region: string } }
) {
  const region = contextFromNext.params.region.toUpperCase();
  console.log(`API Route /api/timeline/${region} called. URL: ${request.url}`);

  // --- Cloudflare のランタイムコンテキストを取得 ---
  let env: CloudflareEnv = {} as CloudflareEnv;
  let waitUntil: ExecutionContext['waitUntil'] | undefined;

  try {
    // getRequestContext はリクエストスコープ外で呼び出す必要があるかもしれない (ドキュメント確認)
    // もしリクエストスコープ内で呼ぶなら、try-catch で囲む
    const cfRuntimeContext = getRequestContext();
    if (cfRuntimeContext && cfRuntimeContext.env) {
      env = cfRuntimeContext.env as CloudflareEnv; // 型アサーション
      waitUntil = cfRuntimeContext.waitUntil;
      console.log(`[${region}] Cloudflare runtime context obtained. AI Service available: ${!!env.AI_ANALYZER_SERVICE}, KV available: ${!!env.TIMELINE_CACHE}`);
    } else {
      console.warn(`[${region}] Cloudflare context or env not available via getRequestContext. Falling back to process.env for REGIONS_JSON.`);
    }
  } catch (e) {
    console.error(`[${region}] Error obtaining Cloudflare context with getRequestContext:`, e);
    // エラー時も process.env.REGIONS_JSON は試みる
  }
  // REGIONS_JSON は process.env からも取得試行 (ビルド時環境変数として)
  if (!env.REGIONS_JSON && process.env.REGIONS_JSON) {
      env.REGIONS_JSON = process.env.REGIONS_JSON;
      console.log(`[${region}] REGIONS_JSON obtained from process.env.`);
  }


  // --- 1. 環境変数 (Regions JSON) の取得と検証 ---
  const regionsJsonString = env.REGIONS_JSON;
  let regionConfig: Record<string, string> = {};
  if (typeof regionsJsonString !== 'string' || regionsJsonString === '') {
     console.error(`[${region}] Environment variable REGIONS_JSON is not set or empty (checked context.env and process.env).`);
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
  const instanceDomains: string[] = instancesString.split(',').map(d=>d.trim()).filter(Boolean);
  if (instanceDomains.length === 0) {
    console.error(`[${region}] No valid instance domains found after parsing.`);
    return NextResponse.json({ error: `No valid instances found for region: ${region}` }, { status: 400 });
  }
  console.log(`[${region}] Target instance domains:`, instanceDomains);

  // --- 3. KVキャッシュ確認 ---
  const kv = env.TIMELINE_CACHE; // getRequestContext から取得した env を使用
  const cacheKey = `timeline-response:${region}`;
  if (kv) {
    try {
      const cachedDataString = await kv.get(cacheKey);
      if (cachedDataString) {
         console.log(`[${region}] Cache hit for response (key: ${cacheKey}).`);
         const cachedResponse: TimelineApiResponse = JSON.parse(cachedDataString);
         return NextResponse.json(cachedResponse);
       }
      console.log(`[${region}] Cache miss for response (key: ${cacheKey}).`);
    } catch (e) { console.error(`[${region}] KV Cache read error:`, e); }
  } else {
    console.warn(`[${region}] TIMELINE_CACHE binding not available in env.`);
  }

  // --- 4. Mastodon API から投稿データを取得 ---
  let combinedStatuses: MastodonStatus[] = [];
  try {
    const results = await Promise.all(instanceDomains.map(async (domain: string): Promise<MastodonStatus[]> => {
        const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
        console.log(`[${region}] Fetching from Mastodon API: ${url}`);
        try {
          const response = await fetch(url, { headers: { 'Accept': 'application/json' }});
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
    }));
    combinedStatuses = results.flat().sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0,50);
    console.log(`[${region}] Fetched ${combinedStatuses.length} statuses in total.`);
  } catch (error) {
      console.error(`[${region}] Error processing Mastodon API fetch results:`, error);
      return NextResponse.json({ error: 'Failed to process Mastodon API results' }, { status: 500 });
  }

  // --- 5. 感情分析 (サービスバインディング経由) ---
  let sentimentAnalysis: SentimentAnalysisData = {
      positivePercentage: 0, negativePercentage: 0, neutralPercentage: 0,
      totalAnalyzed: 0, counts: { positive: 0, negative: 0, neutral: 0 }
  };
  const aiAnalyzerService = env.AI_ANALYZER_SERVICE; // getRequestContext から取得した env を使用

  if (aiAnalyzerService && combinedStatuses.length > 0) {
      try {
          const textsToAnalyze = combinedStatuses.map(status => stripHtml(status.content));
          console.log(`[${region}] Calling AI Analyzer Service via binding with ${textsToAnalyze.length} texts.`);

          const analyzeApiUrl = new URL(request.url).origin + "/ai-analyze-service-dummy-path"; // パスはサービス側で無視されることが多い
const analyzeResponse = await aiAnalyzerService.fetch(
    analyzeApiUrl, // 第1引数: URL文字列
    {             // 第2引数: RequestInit オブジェクト
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: textsToAnalyze })
    }
);

          if (!analyzeResponse.ok) {
              console.error(`[${region}] AI Analyzer Service call failed: ${analyzeResponse.status} ${analyzeResponse.statusText}`);
              const errorBody = await analyzeResponse.text().catch(() => `Could not read error body from AI service. Status: ${analyzeResponse.status}`);
              console.error(`[${region}] AI Analyzer Service error body: ${errorBody}`);
          } else {
              const analyzeResult = await analyzeResponse.json() as AnalyzeSentimentServiceResponse;
              console.log(`[${region}] Received from AI Analyzer Service: ${analyzeResult?.sentimentResults?.filter(r=>r!==null).length ?? 0} valid results.`);

              let sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
              let totalAnalyzed = 0;
              if (analyzeResult && Array.isArray(analyzeResult.sentimentResults)) {
                  analyzeResult.sentimentResults.forEach(res => {
                      if (res) {
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
              console.log(`[${region}] Sentiment analysis via service successful:`, sentimentAnalysis);
          }
      } catch (e) {
          console.error(`[${region}] Error calling or processing AI Analyzer Service:`, e);
      }
  } else {
      if (!aiAnalyzerService) {
          console.warn(`[${region}] AI Analyzer Service binding (AI_ANALYZER_SERVICE) not available in env.`);
      }
      if (combinedStatuses.length === 0) {
          console.log(`[${region}] No statuses fetched, skipping sentiment analysis.`);
      }
  }

  // --- 6. KVキャッシュへの書き込み ---
  const responsePayload: TimelineApiResponse = {
      timeline: combinedStatuses,
      sentimentAnalysis: sentimentAnalysis
  };
  if (kv && waitUntil) { // getRequestContext から取得した kv と waitUntil を使用
     const responseBodyToCache = JSON.stringify(responsePayload);
     // waitUntil で非同期に実行 (レスポンスをブロックしない)
     waitUntil(
         kv.put(cacheKey, responseBodyToCache, { expirationTtl: 300 }) // 5分キャッシュ
             .then(() => console.log(`[${region}] Response for key ${cacheKey} cached successfully.`))
             .catch(e => console.error(`[${region}] KV Cache (key: ${cacheKey}) write error:`, e))
     );
  } else {
      if (!kv) console.warn(`[${region}] TIMELINE_CACHE binding not available for caching.`);
      if (!waitUntil) console.warn(`[${region}] waitUntil not available for caching.`);
  }

  // --- 7. 最終的なレスポンスを返す ---
  console.log(`[${region}] Sending response with ${combinedStatuses.length} timeline items and sentiment.`);
  return NextResponse.json(responsePayload);
}