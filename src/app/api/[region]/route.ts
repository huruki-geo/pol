// src/app/api/timeline/[region]/route.ts
import { type NextRequest, NextResponse } from 'next/server';

// KVへのアクセス方法の調査が必要なため、型定義は一旦コメントアウト
// interface Env {
//   TIMELINE_CACHE: KVNamespace;
// }

// MastodonStatusの型定義（必要に応じて調整）
interface MastodonStatus {
	id: string;
	created_at: string;
	content: string; // HTML content
	url: string;
	account: {
		acct: string;
	};
	instance_domain?: string;
}

// HTMLサニタイズ関数（必要なら）
//const sanitizeHtml = (html: string): string => {
//    let text = html.replace(/<p>/gi, '').replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
//    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
//    return text.replace(/\s+/g, ' ').trim();
//};


export async function GET(
  request: NextRequest,
  { params }: { params: { region: string } }
  // context?: ExecutionContext & { env: Env } // KV等を使う場合はContextの受け取り方が必要
) {
  const region = params.region.toUpperCase();
  console.log(`API Route requested region: ${region}`);

  // --- 環境変数から Regions JSON を取得 ---
  const regionsJsonString = process.env.REGIONS_JSON;
  let regionConfig: Record<string, string> = {};
  if (regionsJsonString) {
     try {
       regionConfig = JSON.parse(regionsJsonString);
       console.log('Region Config from process.env.REGIONS_JSON:', JSON.stringify(regionConfig));
     } catch (e) {
        console.error("Failed to parse REGIONS_JSON:", e);
        return NextResponse.json({ error: 'Server config error (regions invalid)' }, { status: 500 });
     }
  } else {
     console.error("Environment variable REGIONS_JSON is not set.");
     return NextResponse.json({ error: 'Server config error (regions missing)' }, { status: 500 });
  }

  // --- 対象リージョンのインスタンスリストを取得 ---
  const instancesString = regionConfig[region];
  if (!instancesString) {
      console.error(`No instances configured for region: ${region}`);
      // リージョン定義が見つからない場合は404を返す
      return NextResponse.json({ error: `No instances configured for region: ${region}` }, { status: 404 });
  }
  const instanceDomains = instancesString.split(',').map(domain => domain.trim()).filter(Boolean);
  if (instanceDomains.length === 0) {
    return NextResponse.json({ error: `No valid instances found for region: ${region}` }, { status: 400 });
  }

  // --- KV キャッシュ確認 (一旦コメントアウト) ---
  // const kv = context?.env.TIMELINE_CACHE;
  // const cacheKey = `timeline:${region}:notranslation`;
  // if (kv) {
  //   try {
  //     const cachedData = await kv.get(cacheKey);
  //     if (cachedData) {
  //        console.log(`Cache hit for ${region}`);
  //        return new Response(cachedData, { headers: { 'Content-Type': 'application/json', 'X-Cache-Status': 'HIT' } });
  //      }
  //     console.log(`Cache miss for ${region}`);
  //   } catch (e) { console.error("KV read error:", e); }
  // } else { console.warn("KV binding 'TIMELINE_CACHE' not available"); }


  // --- Mastodon API 呼び出し ---
  const fetchPromises: Promise<MastodonStatus[]>[] = instanceDomains.map(async (domain) => {
    const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
    try {
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!response.ok) {
        console.error(`Failed to fetch from ${domain}: ${response.status}`);
        return [];
      }
      // レスポンスがJSON形式か確認
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
  let combinedStatuses: MastodonStatus[] = []; // ここで定義！
  try {
      const results = await Promise.all(fetchPromises);
      combinedStatuses = results.flat();
      combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      combinedStatuses = combinedStatuses.slice(0, 50); // 取得件数を制限
      console.log(`Fetched ${combinedStatuses.length} statuses for region ${region}`);
  } catch (error) {
      console.error('Error processing fetch results:', error);
      return NextResponse.json({ error: 'Failed to process fetch results' }, { status: 500 });
  }


  // --- KV キャッシュへの書き込み (一旦コメントアウト) ---
  // if (kv && combinedStatuses.length > 0) {
  //    const responseBody = JSON.stringify(combinedStatuses);
  //    context?.waitUntil(kv.put(cacheKey, responseBody, { expirationTtl: 300 }).catch(e => console.error("KV write error:", e)));
  // }

  // --- 結果を JSON で返す ---
  return NextResponse.json(combinedStatuses);
}