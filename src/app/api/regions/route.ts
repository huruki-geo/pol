// src/app/api/regions/route.ts
import { NextResponse } from 'next/server';

// この API ルートも Edge Runtime で動作させる
export const runtime = 'edge';

export async function GET() {
  console.log("API Route /api/regions called!");

  // Cloudflare ダッシュボードで設定された環境変数 REGIONS_JSON を取得
  const regionsJsonString = process.env.REGIONS_JSON;
  let regionConfig: Record<string, string> = {}; // 例: {"EU": "mastodon.social,...", "DE": "..."}

  if (typeof regionsJsonString !== 'string' || regionsJsonString === '') {
     console.error("Environment variable REGIONS_JSON is not set or empty.");
     // 環境変数が設定されていない場合はエラーを返す
     return NextResponse.json({ error: 'Server configuration error (regions missing)' }, { status: 500 });
  }

  try {
     // JSON 文字列をパース
     regionConfig = JSON.parse(regionsJsonString);
  } catch (e) {
     console.error("Failed to parse REGIONS_JSON:", e);
     // パースに失敗した場合もエラー
     return NextResponse.json({ error: 'Server configuration error (regions invalid)' }, { status: 500 });
  }

  // regionConfig のキー (地域コード) を使って、フロントエンド向けの選択肢リストを作成
  // ここではキー (例: "DE") をそのまま表示名として使うシンプルな例
  // 必要であれば、別途表示名マッピングを用意することも可能
  const availableRegions = Object.keys(regionConfig).map(code => ({
    code: code, // 例: "DE"
    name: code // 例: "Germany" のような表示名が必要なら別途マッピングする
                // 今回はシンプルにコードを表示名とする
  }));

  console.log("Available regions fetched:", availableRegions);

  // 利用可能な地域のリストを JSON で返す
  return NextResponse.json(availableRegions);
}