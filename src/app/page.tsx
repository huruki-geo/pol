// src/app/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import RegionSelector from '../components/RegionSelector'; // ドロップダウンセレクター
import TimelineCard from '../components/TimelineCard';     // 投稿カード
import Spinner from '../components/Spinner';               // ローディングスピナー
import SentimentDisplay from '../components/SentimentDisplay'; // 感情分析表示

// --- 型定義 ---

/** Mastodon ステータス（投稿）の型 */
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

/** 地域選択肢の型 (API /api/regions から返される想定) */
interface RegionOption {
    code: string; // 例: "DE", "FR"
    name: string; // 例: "Germany", "France" (現状 API は code を返す)
}

/** 感情分析データの型 (API /api/timeline/[region] から返される想定) */
interface SentimentAnalysisData {
    positivePercentage: number;
    negativePercentage: number;
    neutralPercentage: number;
    totalAnalyzed: number;
    counts: { positive: number; negative: number; neutral: number };
}

/** API /api/timeline/[region] レスポンス全体の型 */
interface TimelineApiResponse {
    timeline: MastodonStatus[];
    sentimentAnalysis: SentimentAnalysisData;
}

// --- React Component ---

export default function HomePage() {
  // --- State Declarations ---
  const [availableRegions, setAvailableRegions] = useState<RegionOption[]>([]); // 利用可能な地域のリスト
  const [selectedRegion, setSelectedRegion] = useState<string>(''); // ユーザーが選択した地域コード (初期値は空)
  const [timeline, setTimeline] = useState<MastodonStatus[]>([]); // 表示するタイムラインデータ
  const [sentimentData, setSentimentData] = useState<SentimentAnalysisData | null>(null); // 感情分析データ
  const [loadingTimeline, setLoadingTimeline] = useState<boolean>(false); // タイムライン取得中のローディング状態
  const [loadingRegions, setLoadingRegions] = useState<boolean>(true); // 地域リスト取得中のローディング状態
  const [error, setError] = useState<string | null>(null); // エラーメッセージ

  // --- Data Fetching Callbacks ---

  /** 利用可能な地域のリストを /api/regions から取得する */
  const fetchAvailableRegions = useCallback(async () => {
    setLoadingRegions(true);
    setError(null); // 既存のエラーをクリア
    try {
      const response = await fetch('/api/regions');
      if (!response.ok) {
        // API エラーレスポンスを解析してエラーメッセージを生成
        const errorData: unknown = await response.json().catch(() => ({ error: `HTTP error ${response.status}` }));
        let errorMessage = `Failed to fetch regions: ${response.statusText} (${response.status})`;
        if (typeof errorData === 'object' && errorData !== null && 'error' in errorData && typeof errorData.error === 'string') {
            errorMessage = errorData.error;
        }
        throw new Error(errorMessage);
      }
      const data: RegionOption[] = await response.json();
      setAvailableRegions(data);

      // 地域リストが取得でき、かつ地域が未選択の場合、最初の地域をデフォルトで選択
      if (data.length > 0 && selectedRegion === '') {
        setSelectedRegion(data[0].code);
      } else if (data.length === 0) {
        setError("No available regions found. Please check configuration."); // 設定がない場合のエラー
      }
    } catch (err: unknown) {
      console.error('Fetch regions error:', err);
      if (err instanceof Error) {
        setError(`Failed to load available regions: ${err.message}`);
      } else {
        setError('An unknown error occurred while loading regions.');
      }
      setAvailableRegions([]); // エラー時はリストを空にする
    } finally {
      setLoadingRegions(false);
    }
  // selectedRegion を依存配列に含め、初期選択ロジックが正しく動作するようにする
  }, [selectedRegion]); // selectedRegion が変更された場合も再評価（ただし通常は初回のみ）


  /** 選択された地域のタイムラインと感情分析結果を /api/timeline/[region] から取得する */
  const fetchTimelineAndSentiment = useCallback(async (region: string | null) => {
    // region が null または空文字列の場合は処理を中断
    if (!region) {
        setTimeline([]);
        setSentimentData(null);
        setLoadingTimeline(false); // ローディング解除
        return;
    }

    setLoadingTimeline(true);
    setError(null); // 既存のエラーをクリア
    setTimeline([]);
    setSentimentData(null);

    try {
      const response = await fetch(`/api/timeline/${region}`);
      if (!response.ok) {
        // API エラーレスポンスを解析
        let errorMessage = `Failed to fetch timeline data: ${response.statusText} (${response.status})`;
         try {
            const errorData: unknown = await response.json();
            if (typeof errorData === 'object' && errorData !== null && 'error' in errorData && typeof errorData.error === 'string') {
                errorMessage = errorData.error; // APIからのエラーメッセージを採用
            }
        } catch (_jsonError) { /* ignore json parse error, use status text */ }
        console.error("Failed to parse timeline error response as JSON:");
        throw new Error(errorMessage);
      }

      // レスポンスが JSON か確認
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
         throw new Error(`Received non-JSON response from timeline API: ${contentType}`);
      }

      // データを State にセット
      const data: TimelineApiResponse = await response.json();
      setTimeline(data.timeline || []);
      setSentimentData(data.sentimentAnalysis || null);

    } catch (err: unknown) {
      console.error('Fetch timeline/sentiment error:', err);
      if (err instanceof Error) { setError(err.message); }
      else { setError('An unknown error occurred while fetching the timeline.'); }
      setTimeline([]); // エラー時は空にする
      setSentimentData(null);
    } finally {
      setLoadingTimeline(false);
    }
  }, []); // この関数自体は再生成不要

  // --- Effects ---

  // マウント時に地域リストを取得
  useEffect(() => {
    fetchAvailableRegions();
  }, [fetchAvailableRegions]);

  // 選択された地域が変わるか、地域リストのロードが完了したらタイムラインを取得
  useEffect(() => {
    if (selectedRegion && !loadingRegions) {
      fetchTimelineAndSentiment(selectedRegion);
    }
    // 地域選択が解除された場合（selectedRegion が '' になった場合）は fetchTimelineAndSentiment が内部で処理
  }, [selectedRegion, fetchTimelineAndSentiment, loadingRegions]);

  // --- Render Logic ---

  // RegionSelector に渡すオプションを整形 { "DE": "Germany (DE)", ... }
  const regionSelectorOptions = availableRegions.reduce((acc, region) => {
      // API から取得した name を使う (今回は code と同じ想定)
      acc[region.code] = `${region.name} (${region.code})`;
      return acc;
    }, {} as Record<string, string>);

  // --- JSX ---
  return (
    <div className="container mx-auto p-4 min-h-screen flex flex-col">
      {/* --- Header --- */}
      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-2 text-center text-gray-800">Mastodon Regional Feed</h1>
        <p className="text-gray-600 text-center mb-4">View public posts from selected regions.</p>
        <div className="flex justify-center">
           {/* 地域リストのローディング */}
           {loadingRegions && <Spinner />}
           {/* 地域リスト取得エラー */}
           {!loadingRegions && error && availableRegions.length === 0 && (
              <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-2 rounded text-center text-sm" role="alert">
                 Could not load regions: {error}
              </div>
           )}
           {/* RegionSelector (ロード完了し、地域リストが存在する場合) */}
           {!loadingRegions && availableRegions.length > 0 && (
                <RegionSelector
                    regions={regionSelectorOptions}
                    selectedRegion={selectedRegion}
                    onSelectRegion={setSelectedRegion}
                    disabled={loadingTimeline || loadingRegions} // タイムラインまたは地域リストロード中は無効
                />
           )}
        </div>
         <p className="text-sm text-gray-500 mt-2 text-center">
            Note: Displaying latest public posts in their original language. Sentiment analysis is experimental.
        </p>
      </header>

      {/* --- Main Content Area --- */}
      <main className="flex-grow">
        {/* タイムラインのローディング */}
        {loadingTimeline && <Spinner />}

        {/* タイムライン取得エラー表示 */}
        {!loadingTimeline && error && !loadingRegions && selectedRegion && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-center max-w-2xl mx-auto" role="alert">
                <strong className="font-bold">Error loading timeline for {selectedRegion}:</strong>
                <span className="block sm:inline"> {error}</span>
            </div>
        )}

        {/* 感情分析結果表示 */}
        {!loadingTimeline && !error && sentimentData && timeline.length > 0 && (
            <div className="my-6 max-w-2xl mx-auto">
                <h2 className="text-lg font-semibold text-center mb-3 text-gray-700">Timeline Sentiment Analysis</h2>
                <SentimentDisplay data={sentimentData} />
            </div>
        )}

        {/* データなし表示 */}
        {!loadingTimeline && !error && timeline.length === 0 && !loadingRegions && selectedRegion && (
          <p className="text-center text-gray-500 py-8">No posts found for {selectedRegion}.</p>
        )}
        {/* 地域未選択時の表示 (ロード完了後) */}
        {!loadingTimeline && !error && !selectedRegion && !loadingRegions && availableRegions.length > 0 && (
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
            <p>Powered by Mastodon Public APIs, Cloudflare Pages & Workers AI.</p>
            <p className="mt-1">
                <a href="https://github.com/huruki-geo/pol" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">GitHub Repository</a>
            </p>
            <p className="mt-1">Please respect instance rules when interacting.</p>
        </footer>
    </div>
  );
}