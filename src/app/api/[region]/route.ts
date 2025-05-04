// src/app/api/timeline/[region]/route.ts

import { type NextRequest, NextResponse } from 'next/server';

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
 * Next.js App Router の Route Handler が受け取るコンテキストの型定義。
 * 動的ルートパラメータ `region` を含みます。
 */
//interface TimelineContext {
//  params: {
//    region: string;
//  }
//}

/**
 * 指定された地域の Mastodon 公開タイムラインを取得する API ルートハンドラ (GET)。
 */
export async function GET(
    request: NextRequest,
    context: any // ★★★ 2番目の引数の型を一時的に 'any' にしてみる ★★★
  ) {
    // ★★★ context.params にアクセスする前に存在確認を追加 ★★★
    if (!context || !context.params || typeof context.params.region !== 'string') {
        console.error("Invalid context or params received:", context);
        return NextResponse.json({ error: 'Invalid request context' }, { status: 400 });
    }
    const region = context.params.region.toUpperCase();
    console.log(`API Route requested region: ${region}`);

  // --- 環境変数からリージョンごとのインスタンス設定 (JSON文字列) を取得 ---
  const regionsJsonString = process.env.REGIONS_JSON; // Cloudflare Pages ダッシュボードで設定
  let regionConfig: Record<string, string> = {};

  if (typeof regionsJsonString !== 'string' || regionsJsonString === '') {
     console.error("Environment variable REGIONS_JSON is not set or empty.");
     // 設定が見つからない場合はサーバーエラーを返す
     return NextResponse.json({ error: 'Server configuration error (regions missing)' }, { status: 500 });
  }

  try {
     // JSON文字列をパースしてオブジェクトに変換
     regionConfig = JSON.parse(regionsJsonString);
     console.log('Region Config:', JSON.stringify(regionConfig));
   } catch (e) {
     console.error("Failed to parse REGIONS_JSON:", e);
     // パースに失敗した場合もサーバーエラー
     return NextResponse.json({ error: 'Server configuration error (regions invalid)' }, { status: 500 });
   }

  // --- リクエストされたリージョンに対応するインスタンスドメインを取得 ---
  const instancesString: string | undefined = regionConfig[region];

  if (instancesString === undefined || instancesString === null || instancesString === '') {
      console.error(`No instances configured or empty string for region: ${region}`);
      // リージョン定義が見つからないか空の場合は 404 Not Found を返す
      return NextResponse.json({ error: `No instances configured for region: ${region}` }, { status: 404 });
  }

  // カンマ区切りのドメイン文字列を配列に変換し、前後の空白を除去、空の要素を除外
  const instanceDomains: string[] = instancesString.split(',')
                                      .map(domain => domain.trim())
                                      .filter(Boolean);

  if (instanceDomains.length === 0) {
    // 有効なドメインが見つからなかった場合は 400 Bad Request を返す
    return NextResponse.json({ error: `No valid instances found for region: ${region}` }, { status: 400 });
  }
  console.log(`Target instance domains for ${region}:`, instanceDomains);


  // --- KVキャッシュの確認 (将来的に実装する場合) ---
  // const kv = context?.env?.TIMELINE_CACHE; // Pages Runtime Context から KV を取得する方法 (要調査)
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
  // } else { console.warn("KV binding 'TIMELINE_CACHE' not available or context structure incorrect"); }


  // --- 各インスタンスから公開タイムラインを並行して取得 ---
  const fetchPromises: Promise<MastodonStatus[]>[] = instanceDomains.map(async (domain: string): Promise<MastodonStatus[]> => {
    // Mastodon API v1 の公開タイムラインエンドポイント (ローカル)
    const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
    console.log(`Fetching from: ${url}`); // FetchするURLをログ出力

    try {
      // fetch API でデータを取得
      const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          // 必要であれば AbortController でタイムアウトを設定
      });

      // レスポンスステータスが OK (2xx) でない場合はエラーとして扱う
      if (!response.ok) {
        console.error(`Failed to fetch from ${domain}: ${response.status} ${response.statusText}`);
        // エラー内容をテキストで取得してみる（デバッグ用）
        // const errorText = await response.text().catch(() => 'Could not read error text');
        // console.error(`Error body from ${domain}: ${errorText}`);
        return []; // エラー時は空配列を返す
      }

      // レスポンスの Content-Type が JSON であることを確認
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
          console.error(`Received non-JSON response from ${domain}: ${contentType}`);
          // JSONでない場合はエラーとして扱う
          // const responseText = await response.text().catch(() => 'Could not read response text');
          // console.error(`Non-JSON response body from ${domain}: ${responseText}`);
          return []; // エラー時は空配列を返す
      }

      // JSON をパースし、型アサーションを行う (より安全にするには zod などでバリデーション推奨)
      const statuses = await response.json() as MastodonStatus[];
      // 各ステータスに取得元のインスタンスドメインを追加
      return statuses.map(status => ({ ...status, instance_domain: domain }));

    } catch (error) {
      // fetch 自体のエラー (ネットワークエラーなど)
      console.error(`Error fetching from ${domain}:`, error);
      return []; // エラー時は空配列を返す
    }
  });

  // --- 全てのインスタンスからの取得結果を統合・整形 ---
  let combinedStatuses: MastodonStatus[] = [];
  try {
      // Promise.all で全ての fetch Promise の完了を待つ
      const results = await Promise.all(fetchPromises);
      // 結果の配列 (MastodonStatus[][]) をフラットな配列 (MastodonStatus[]) に変換
      combinedStatuses = results.flat();
      // 作成日時 (created_at) の降順 (新しい順) にソート
      combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      // 結果を最大50件に制限
      combinedStatuses = combinedStatuses.slice(0, 50);
      console.log(`Fetched ${combinedStatuses.length} statuses for region ${region}`);
  } catch (error) {
      // Promise.all や sort, slice でエラーが発生した場合
      console.error('Error processing fetch results:', error);
      return NextResponse.json({ error: 'Failed to process fetch results' }, { status: 500 });
  }

  // --- KVキャッシュへの書き込み (将来的に実装する場合) ---
  // if (kv && combinedStatuses.length > 0) {
  //    const responseBody = JSON.stringify(combinedStatuses);
  //    context?.waitUntil(kv.put(cacheKey, responseBody, { expirationTtl: 300 }).catch(e => console.error("KV write error:", e)));
  //    console.log(`Attempted to cache ${combinedStatuses.length} statuses for region ${region}`);
  // }

  // --- 最終的な結果を JSON レスポンスとして返す ---
  return NextResponse.json(combinedStatuses);
}