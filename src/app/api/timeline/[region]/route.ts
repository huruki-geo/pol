// src/app/api/timeline/[region]/route.ts

import { type NextRequest, NextResponse } from 'next/server';

// --- 型定義 ---

/**
 * Cloudflare Pages Runtime で利用可能な環境変数とバインディングの型 (仮定)。
 * 正確な型は Cloudflare のドキュメントや @cloudflare/workers-types を参照。
 * process.env から取得する場合、型アサーションやチェックが必要になることが多い。
 */
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REGIONS_JSON?: string; // 環境変数 (JSON 文字列)
      // Cloudflare ダッシュボードでバインドされたオブジェクトは process.env に直接入らない可能性が高い
      // AI?: any; // Workers AI Binding (アクセス方法は要確認)
      // TIMELINE_CACHE?: KVNamespace; // KV Binding (アクセス方法は要確認)
    }
  }
  // Cloudflare Pages の Execution Context (もし KV や AI をここから使う場合)
  // interface ExecutionContext {
  //  env: {
  //    AI: { run: (model: string, inputs: any) => Promise<any> }; // AI Binding の型 (仮)
  //    TIMELINE_CACHE: KVNamespace; // KV Binding の型
  //  };
  //  waitUntil(promise: Promise<any>): void;
  // }
}


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
 * Workers AI テキスト分類モデルの入力型 (仮)。
 */
interface AiTextClassificationInput {
    text: string;
}

/**
 * Workers AI テキスト分類モデルの出力型 (仮)。モデルにより異なる可能性あり。
 */
interface AiTextClassificationOutput {
    label: string;
    score: number;
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
 * API レスポンス全体の型。
 */
interface ApiResponse {
    timeline: MastodonStatus[];
    sentimentAnalysis: SentimentAnalysisData;
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
  // context の型は Next.js + Cloudflare Pages Runtime の仕様に依存
  // ここでは分割代入を使い、型チェックは内部で行う
  context: any
  // context?: ExecutionContext // 必要に応じて ExecutionContext を受け取る (要調査)
) {
  if (!context || typeof context !== 'object' || !context.params || typeof context.params !== 'object' || typeof context.params.region !== 'string') {
    console.error("Invalid context or params:", context);
    return NextResponse.json({ error: "Invalid request context or region parameter" }, { status: 400 });
 }
 const region = context.params.region.toUpperCase();
 console.log(`API Route requested region: ${region}`);

  // --- 環境変数 (Regions JSON) の取得と検証 ---
  const regionsJsonString = process.env.REGIONS_JSON;
  let regionConfig: Record<string, string> = {};

  if (typeof regionsJsonString !== 'string' || regionsJsonString === '') {
     console.error("Environment variable REGIONS_JSON is not set or empty.");
     return NextResponse.json({ error: 'Server configuration error (regions missing)' }, { status: 500 });
  }

  try {
     regionConfig = JSON.parse(regionsJsonString);
     console.log('Region Config:', JSON.stringify(regionConfig));
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


  // --- KV キャッシュ確認 (コメントアウト中) ---
  // const kv = context?.env?.TIMELINE_CACHE;
  // const cacheKey = `timeline:${region}:notranslation`;
  // ... (キャッシュ読み取りロジック) ...


  // --- Mastodon API 呼び出し ---
  const fetchPromises: Promise<MastodonStatus[]>[] = instanceDomains.map(async (domain: string): Promise<MastodonStatus[]> => {
    const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
    console.log(`Fetching from: ${url}`);
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
      return []; // catch ブロックで return []
    }
  });

  // --- 結果の集計と整形 ---
  let combinedStatuses: MastodonStatus[] = [];
  try {
      const results = await Promise.all(fetchPromises);
      combinedStatuses = results.flat();
      combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      combinedStatuses = combinedStatuses.slice(0, 50);
      console.log(`Fetched ${combinedStatuses.length} statuses for region ${region}`);
  } catch (error) {
      console.error('Error processing fetch results:', error);
      return NextResponse.json({ error: 'Failed to process fetch results' }, { status: 500 });
  }

  // --- 感情分析処理 ---
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  let totalAnalyzed = 0;
  interface SentimentResultDebug { id: string; label: string; score: number; }
  const sentimentResults: SentimentResultDebug[] = [];

  // --- Workers AI へのアクセス方法 (要調査・修正) ---
  // Cloudflare Pages Runtime Context から 'AI' binding を取得する必要がある可能性が高い
  // const ai = context?.env?.AI;
  // process.env.AI は通常オブジェクトを直接は保持しない
  // ここではダミーとして null を設定しておく
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai: any = null; // ★★★ Cloudflare Pages Runtime での正しい AI Binding アクセス方法に修正が必要 ★★★
  // if (!ai) { console.warn("AI binding not available in this context."); }

  if (ai && combinedStatuses.length > 0) {
      const model = '@cf/huggingface/distilbert-sst-2-int8'; // 使用するモデル

      const analysisPromises = combinedStatuses.map(async (status) => {
          const textToAnalyze = stripHtml(status.content);
          if (textToAnalyze.length < 10 || textToAnalyze.length > 500) { return null; }
          try {
              const inputs: AiTextClassificationInput = { text: textToAnalyze };
              // ★★★ 正しい AI オブジェクトを使って run を呼び出す ★★★
              const result: AiTextClassificationOutput[] = await ai.run(model, inputs);

              if (result && result.length > 0) {
                  const topResult = result.reduce((prev, current) => (prev.score > current.score) ? prev : current);
                  sentimentResults.push({ id: status.id, label: topResult.label, score: topResult.score });

                  const label = topResult.label.toUpperCase();
                   if (label.includes("POSITIVE") || label === 'LABEL_1') { return 'positive'; }
                   else if (label.includes("NEGATIVE") || label === 'LABEL_0') { return 'negative'; }
                   else { return 'neutral'; }
              }
          } catch (aiError) { console.error(`AI analysis error for status ${status.id}:`, aiError); }
          return null;
      });

      const analysisResults = await Promise.all(analysisPromises);
      analysisResults.forEach(resultLabel => {
          if (resultLabel) {
              sentimentCounts[resultLabel as keyof typeof sentimentCounts]++;
              totalAnalyzed++;
          }
      });
      console.log(`Sentiment analysis complete for ${region}. Analyzed: ${totalAnalyzed}, Counts:`, sentimentCounts);
      console.log("Sample AI results:", sentimentResults.slice(0, 5));
  } else {
      console.warn("AI binding not available or no statuses to analyze.");
  }

  // --- 集計結果を計算 ---
  const sentimentAnalysis: SentimentAnalysisData = {
      positivePercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.positive / totalAnalyzed) * 100) : 0,
      negativePercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.negative / totalAnalyzed) * 100) : 0,
      neutralPercentage: totalAnalyzed > 0 ? Math.round((sentimentCounts.neutral / totalAnalyzed) * 100) : 0,
      totalAnalyzed: totalAnalyzed,
      counts: sentimentCounts
  };


  // --- KVキャッシュへの書き込み (コメントアウト中) ---
  // const kv = context?.env?.TIMELINE_CACHE;
  // if (kv && combinedStatuses.length > 0) {
  //    const responseBody = JSON.stringify({ timeline: combinedStatuses, sentimentAnalysis }); // レスポンス全体をキャッシュ
  //    context?.waitUntil(kv.put(cacheKey, responseBody, { expirationTtl: 300 }).catch(e => console.error("KV write error:", e)));
  // }

  // --- 最終的な結果を JSON レスポンスとして返す ---
  const responsePayload: ApiResponse = {
      timeline: combinedStatuses,
      sentimentAnalysis: sentimentAnalysis
  };

  return NextResponse.json(responsePayload);
}