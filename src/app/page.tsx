// app/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import RegionSelector from '../components/RegionSelector';
import TimelineCard from '../components/TimelineCard';
import Spinner from '../components/Spinner'; // スピナーコンポーネントをインポート

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

const REGIONS: Record<string, string> = { // 型を明示
  EU: 'EU',
  DE: 'Germany',
  FR: 'France',
  UK: 'UK',
  ES: 'Spain',
  // Add more regions here matching dashboard env var
};

export default function HomePage() {
  const [selectedRegion, setSelectedRegion] = useState<string>('EU');
  const [timeline, setTimeline] = useState<MastodonStatus[]>([]);
  const [loading, setLoading] = useState<boolean>(true); // 初期状態をローディング中に変更
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async (region: string) => {
    setLoading(true);
    setError(null);
    setTimeline([]);

    try {
      const response = await fetch(`/api/timeline/${region}`);
      if (!response.ok) {
        let errorMessage = `Failed to fetch timeline: ${response.statusText} (${response.status})`;
        try {
           // まず response.json() を試みる
          const errorData: unknown = await response.json(); // 型を unknown で受ける

          // ★★★ 型ガード: errorData がオブジェクトで、error プロパティを持つかチェック ★★★
          if (typeof errorData === 'object' && errorData !== null && 'error' in errorData && typeof errorData.error === 'string') {
             // error プロパティが string 型ならそれを使う
            errorMessage = errorData.error;
          }
        } catch (jsonError) {
          // response.json() 自体が失敗した場合 (レスポンスがJSONでないなど)
          console.error("Failed to parse error response as JSON:", jsonError);
          // 既に設定されている HTTP ステータスベースのエラーメッセージを使う
        }
        // 特定された、またはデフォルトのエラーメッセージで Error を throw する
        throw new Error(errorMessage);
      }

      // ... (response.ok だった場合の処理) ...
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
         throw new Error(`Received non-JSON response: ${contentType}`);
      }
      const data: MastodonStatus[] = await response.json();
      setTimeline(data);

    } catch (err: unknown) { // ここの catch は変更なしで OK
      console.error('Fetch error:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred while fetching data.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTimeline(selectedRegion);
  }, [selectedRegion, fetchTimeline]);

  return (
    <div className="container mx-auto p-4 min-h-screen flex flex-col">
      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-2 text-center text-gray-800">Mastodon European Feed</h1>
        <p className="text-gray-600 text-center mb-4">Public posts from selected European instances.</p>
        <div className="flex justify-center">
            <RegionSelector
            regions={REGIONS}
            selectedRegion={selectedRegion}
            onSelectRegion={setSelectedRegion}
            />
        </div>
         <p className="text-sm text-gray-500 mt-2 text-center">
            Note: Showing latest public posts in their original language. Information accuracy is not guaranteed.
        </p>
      </header>

      <main className="flex-grow">
        {/* ローディング表示 */}
        {loading && <Spinner />}

        {/* エラー表示 */}
        {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-center" role="alert">
                <strong className="font-bold">Error:</strong>
                <span className="block sm:inline"> {error}</span>
            </div>
        )}

        {/* データなし表示 */}
        {!loading && !error && timeline.length === 0 && (
          <p className="text-center text-gray-500 py-8">No posts found for this region or failed to load.</p>
        )}

        {/* タイムライン表示 */}
        {!loading && !error && timeline.length > 0 && (
            <div className="space-y-4 max-w-2xl mx-auto">
                {timeline.map((status) => (
                    <TimelineCard key={status.id} status={status} />
                ))}
            </div>
        )}
      </main>

       {/* フッター */}
       <footer className="mt-12 pt-6 border-t border-gray-200 text-center text-xs text-gray-500">
            <p>Powered by Mastodon Public APIs & Cloudflare Pages.</p>
            <p className="mt-1">
                <a href="https://github.com/huruki-geo/pol" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">GitHub Repository</a>
                 {/* 他のリンクを追加 */}
            </p>
            <p className="mt-1">Please respect instance rules when interacting.</p>
        </footer>
    </div>
  );
}