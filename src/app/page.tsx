// app/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import RegionSelector from '../components/RegionSelector';
import TimelineCard from '../components/TimelineCard';

// Define types matching the API response (no translated_content)
interface MastodonStatus {
	id: string;
	created_at: string;
	content: string; // HTML content
	url: string;
	account: {
		acct: string;
	};
	instance_domain?: string;
	// translated_content?: string; <-- Removed
}

const REGIONS = {
  EU: 'EU',
  DE: 'Germany',
  FR: 'France',
  UK: 'UK',
  ES: 'Spain',
  // Add more regions here matching wrangler.toml
};

export default function HomePage() {
  const [selectedRegion, setSelectedRegion] = useState<string>('EU');
  const [timeline, setTimeline] = useState<MastodonStatus[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async (region: string) => {
    setLoading(true);
    setError(null);
    setTimeline([]);

    try {
      const response = await fetch(`/api/timeline/${region}`); // Use relative path
      if (!response.ok) {
        throw new Error(`Failed to fetch timeline: ${response.statusText} (${response.status})`);
      }
       // Check content type before parsing JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
         throw new Error(`Received non-JSON response: ${contentType}`);
      }

      const data: MastodonStatus[] = await response.json();
      setTimeline(data);
    } catch (err: unknown) { // <-- any を unknown に変更
      console.error('Fetch error:', err);
      // err が Error インスタンスかチェックしてから message プロパティにアクセスする
      if (err instanceof Error) {
        setError(err.message || 'An error occurred while fetching data.');
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
    <div className="container mx-auto p-4">
      <header className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Mastodon European Feed</h1>
        <p className="text-gray-600">Public posts from selected European instances (Original Language).</p> {/* Updated description */}
        <RegionSelector
          regions={REGIONS}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
        />
         <p className="text-sm text-gray-500 mt-2">
            Note: Showing latest public posts in their original language. Information accuracy is not guaranteed.
        </p>
      </header>

      <main>
        {/* Loading, Error, No Posts states */}
        {loading && <p className="text-center text-blue-500">Loading timeline...</p>}
        {error && <p className="text-center text-red-500">Error: {error}</p>}
        {!loading && !error && timeline.length === 0 && (
          <p className="text-center text-gray-500">No posts found for this region or failed to load.</p>
        )}
        <div className="space-y-4">
          {timeline.map((status) => (
            <TimelineCard key={status.id} status={status} />
          ))}
        </div>
      </main>
       <footer className="mt-8 text-center text-xs text-gray-400">
            Powered by Mastodon Public APIs & Cloudflare Workers. Respect Instance Rules.
        </footer>
    </div>
  );
}