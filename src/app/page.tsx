// src/app/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import RegionSelector from '../components/RegionSelector';
import TimelineCard from '../components/TimelineCard';
import Spinner from '../components/Spinner';

// Mastodon ステータスの型定義
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

// 地域選択肢の型定義
interface RegionOption {
    code: string; // 例: "DE", "FR"
    name: string; // 例: "Germany", "France" (今回は API から code をそのまま使う)
}

export default function HomePage() {
  // --- State Declarations ---
  const [availableRegions, setAvailableRegions] = useState<RegionOption[]>([]); // APIから取得する地域リスト
  const [selectedRegion, setSelectedRegion] = useState<string>(''); // ユーザーが選択した地域コード
  const [timeline, setTimeline] = useState<MastodonStatus[]>([]); // 表示するタイムラインデータ
  const [loadingTimeline, setLoadingTimeline] = useState<boolean>(false); // タイムライン取得中のローディング状態
  const [loadingRegions, setLoadingRegions] = useState<boolean>(true); // 地域リスト取得中のローディング状態
  const [error, setError] = useState<string | null>(null); // エラーメッセージ

  // --- Data Fetching Callbacks ---

  // 利用可能な地域のリストをAPIから取得する関数
  const fetchAvailableRegions = useCallback(async () => {
    setLoadingRegions(true);
    setError(null); // エラーをクリア
    try {
      const response = await fetch('/api/regions');
      if (!response.ok) {
        let errorMessage = `Failed to fetch regions: ${response.statusText} (${response.status})`;
        try {
          const errorData: unknown = await response.json();
          // ★★★ 型ガード ★★★
          if (typeof errorData === 'object' && errorData !== null && 'error' in errorData && typeof errorData.error === 'string') {
            errorMessage = errorData.error;
          }
        } catch (jsonError) {
          console.error("Failed to parse regions error response as JSON:", jsonError);
        }
        throw new Error(errorMessage);
      }
      const data: RegionOption[] = await response.json();
      setAvailableRegions(data);

      // 地域リストが取得できたら、まだ地域が選択されていなければ最初の地域を選択状態にする
      if (data.length > 0 && !selectedRegion) {
        setSelectedRegion(data[0].code);
      } else if (data.length === 0) {
          setError("No available regions found in configuration."); // 設定がない場合のエラー
      }
    } catch (err: unknown) {
      console.error('Fetch regions error:', err);
      if (err instanceof Error) {
        setError(`Failed to load available regions: ${err.message}`);
      } else {
        setError('An unknown error occurred while loading regions.');
      }
      setAvailableRegions([]); // エラー時は選択肢を空にする
    } finally {
      setLoadingRegions(false);
    }
  // selectedRegion は初期選択のために依存配列に入れるが、fetchAvailableRegions自体は初回のみ呼びたいので注意
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回のみ実行するため依存配列は空にするか、必要なら selectedRegion を含めるか検討


  // 選択された地域のタイムラインをAPIから取得する関数
  const fetchTimeline = useCallback(async (region: string) => {
    // region コードが有効でない（空など）場合は何もしない
    if (!region) return;

    setLoadingTimeline(true);
    setError(null); // 既存のエラーをクリア
    setTimeline([]); // 既存のタイムラインをクリア

    try {
      const response = await fetch(`/api/timeline/${region}`);
      if (!response.ok) {
          let errorMessage = `Failed to fetch timeline: ${response.statusText} (${response.status})`;
          try {
              const errorData: unknown = await response.json();
              // ★★★ 型ガード ★★★
              if (typeof errorData === 'object' && errorData !== null && 'error' in errorData && typeof errorData.error === 'string') {
                  errorMessage = errorData.error;
              }
          } catch (jsonError) {
              console.error("Failed to parse timeline error response as JSON:", jsonError);
          }
           // 404の場合のメッセージ調整は残しても良い
          if (response.status === 404 && !errorMessage.includes('No timeline data found')) {
               errorMessage = `No timeline data found or configured for region: ${region}`;
          }
          throw new Error(errorMessage);
      }
       // JSON形式チェック
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
         throw new Error(`Received non-JSON response from timeline API: ${contentType}`);
      }
      const data: MastodonStatus[] = await response.json();
      setTimeline(data);
    } catch (err: unknown) {
      console.error('Fetch timeline error:', err);
      if (err instanceof Error) {
        // タイムライン取得エラーとしてセット
        setError(err.message);
      } else {
        setError('An unknown error occurred while fetching the timeline.');
      }
      setTimeline([]); // エラー時はタイムラインを空にする
    } finally {
      setLoadingTimeline(false);
    }
  }, []); // この関数は region が変わった時に呼び出される

  // --- Effects ---

  // コンポーネントのマウント時に利用可能な地域リストを取得
  useEffect(() => {
    fetchAvailableRegions();
  }, [fetchAvailableRegions]);

  // 選択された地域 (selectedRegion) が変更されたら、タイムラインを取得
  useEffect(() => {
    // selectedRegion が空でなく、地域リストのロードが終わっていたら実行
    if (selectedRegion && !loadingRegions) {
      fetchTimeline(selectedRegion);
    }
    // loadingRegions が完了するまで待つことで、意図しない初期フェッチを防ぐ
  }, [selectedRegion, fetchTimeline, loadingRegions]);

  // --- Render Logic ---

  // RegionSelector に渡すためのデータ形式変換
  const regionSelectorOptions = availableRegions.reduce((acc, region) => {
      // APIから返される name を表示名として使う (今回のAPIでは name と code は同じ)
      acc[region.code] = `${region.name} (${region.code})`; // 例: "Germany (DE)"
      return acc;
    }, {} as Record<string, string>);


  return (
    <div className="container mx-auto p-4 min-h-screen flex flex-col">
      {/* --- Header --- */}
      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-2 text-center text-gray-800">Mastodon Regional Feed</h1>
        <p className="text-gray-600 text-center mb-4">View public posts from selected regions.</p>
        <div className="flex justify-center">
           {/* 地域リストのローディング表示 */}
           {loadingRegions && <Spinner />}

           {/* 地域リスト取得エラー表示 (リストが空でエラーがある場合) */}
           {!loadingRegions && error && availableRegions.length === 0 && (
              <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-2 rounded text-center text-sm" role="alert">
                 Could not load regions: {error}
              </div>
           )}

           {/* 地域セレクター (ロード完了し、地域リストが存在する場合) */}
           {!loadingRegions && availableRegions.length > 0 && (
                <RegionSelector
                    regions={regionSelectorOptions} // 整形したオプションを渡す
                    selectedRegion={selectedRegion}
                    onSelectRegion={setSelectedRegion}
                    disabled={loadingTimeline} // タイムライン取得中は無効化
                />
           )}
        </div>
         <p className="text-sm text-gray-500 mt-2 text-center">
            Note: Displaying latest public posts in their original language. Data accuracy not guaranteed.
        </p>
      </header>

      {/* --- Main Content Area --- */}
      <main className="flex-grow">
        {/* タイムラインのローディング表示 */}
        {loadingTimeline && <Spinner />}

        {/* タイムライン取得エラー表示 (地域取得エラーとは区別) */}
        {!loadingTimeline && error && !loadingRegions && ( // 地域ロード中でないことを確認
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-center max-w-2xl mx-auto" role="alert">
                <strong className="font-bold">Error loading timeline for {selectedRegion}:</strong>
                <span className="block sm:inline"> {error}</span>
            </div>
        )}

        {/* データなし表示 */}
        {!loadingTimeline && !error && timeline.length === 0 && !loadingRegions && selectedRegion && (
          <p className="text-center text-gray-500 py-8">No posts found for {selectedRegion}.</p>
        )}
        {/* 地域未選択時の表示 */}
        {!loadingTimeline && !error && timeline.length === 0 && !loadingRegions && !selectedRegion && availableRegions.length > 0 && (
          <p className="text-center text-gray-500 py-8">Select a region above to view posts.</p>
        )}

        {/* タイムライン表示 */}
        {!loadingTimeline && !error && timeline.length > 0 && (
            <div className="space-y-4 max-w-2xl mx-auto">
                {timeline.map((status) => (
                    <TimelineCard key={status.id} status={status} />
                ))}
            </div>
        )}
      </main>

       {/* --- Footer --- */}
       <footer className="mt-12 pt-6 border-t border-gray-200 text-center text-xs text-gray-500">
            <p>Powered by Mastodon Public APIs & Cloudflare Pages.</p>
            <p className="mt-1">
                <a href="https://github.com/huruki-geo/pol" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">GitHub Repository</a>
                 {/* Add other relevant links here */}
            </p>
            <p className="mt-1">Please respect instance rules when interacting.</p>
        </footer>
    </div>
  );
}