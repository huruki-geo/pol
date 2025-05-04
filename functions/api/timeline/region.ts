// functions/api/timeline/[region].ts
import type { EventContext } from "@cloudflare/workers-types";

// Define the expected structure of environment variables and KV from the dashboard
interface Env {
	TIMELINE_CACHE: KVNamespace; // Set via KV namespace bindings in dashboard
	REGIONS_JSON: string;      // Set via Environment variables in dashboard
	// Add other secrets/variables if needed
}

// Define the structure of a Mastodon status
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

// Helper function to sanitize HTML (basic example)
const sanitizeHtml = (html: string): string => {
    let text = html.replace(/<p>/gi, '').replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    return text.replace(/\s+/g, ' ').trim();
};

// Main Function Handler
export const onRequestGet: PagesFunction<Env> = async (context) => {
	const { request, env, params, waitUntil } = context;
	const region = (params.region as string)?.toUpperCase();
	const cacheKey = `timeline:${region}:notranslation`; // Cache key

	// 1. Check KV Cache first (using env.TIMELINE_CACHE)
	try {
		// Access KV using the binding name from dashboard
		const cachedData = await env.TIMELINE_CACHE.get(cacheKey);
		if (cachedData) {
			console.log(`Cache hit for ${region}`);
			return new Response(cachedData, {
				headers: { /* ... headers ... */ 'X-Cache-Status': 'HIT'},
			});
		}
		console.log(`Cache miss for ${region}`);
	} catch (e) {
		console.error("KV Cache read error:", e);
	}

	// 2. Parse Regions configuration from Environment Variable (env.REGIONS_JSON)
	let regionConfig: Record<string, string> = {};
	try {
		// Access the environment variable set in the dashboard
		if (env.REGIONS_JSON) {
			regionConfig = JSON.parse(env.REGIONS_JSON);
			console.log('Region Config from env.REGIONS_JSON:', JSON.stringify(regionConfig));
		} else {
			console.error("Environment variable REGIONS_JSON is not set.");
            // Return error if config is missing
			return new Response(JSON.stringify({ error: 'Server configuration error (regions missing)' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
		}
	} catch (e) {
		console.error("Failed to parse REGIONS_JSON environment variable:", e);
		return new Response(JSON.stringify({ error: 'Server configuration error (regions invalid)' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}

	// 3. Get instances for the requested region
	const instancesString = regionConfig[region];
	console.log(`Instances string for region ${region}: ${instancesString}`);

	if (!instancesString) {
		console.error(`No instances configured for region: ${region}`);
		return new Response(JSON.stringify({ error: `No instances configured for region: ${region}` }), { status: 404, headers: { 'Content-Type': 'application/json' } }); // Return 404 if region definition not found
	}
	const instanceDomains = instancesString.split(',').map(domain => domain.trim()).filter(Boolean);

	if (instanceDomains.length === 0) {
		return new Response(JSON.stringify({ error: `No valid instances found for region: ${region}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 4. Fetch public timelines (no changes needed here)
	const fetchPromises: Promise<MastodonStatus[]>[] = instanceDomains.map(async (domain) => {
		const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
		try {
			const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
			if (!response.ok) {
				console.error(`Failed to fetch from ${domain}: ${response.status}`);
				return []; // Empty array is assignable to MastodonStatus[]
			}
			const statuses = await response.json() as MastodonStatus[]; // Type assertion might be needed here too
            // Add instance domain info to each status
			return statuses.map(status => ({ ...status, instance_domain: domain }));
		} catch (error) {
			console.error(`Error fetching from ${domain}:`, error);
			return []; // Empty array is assignable to MastodonStatus[]
		}
	});

    let combinedStatuses: MastodonStatus[] = [];
	try {
        const results = await Promise.all(fetchPromises);
		combinedStatuses = results.flat();
		combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        combinedStatuses = combinedStatuses.slice(0, 50);
    } catch (error) { /* ... error handling ... */ }

    // 5. No translation

	// 6. Store result in KV Cache (using env.TIMELINE_CACHE via waitUntil)
	if (combinedStatuses.length > 0) {
         const responseBody = JSON.stringify(combinedStatuses);
		waitUntil(
            // Access KV using the binding name from dashboard
			env.TIMELINE_CACHE.put(cacheKey, responseBody, { expirationTtl: 300 })
				.catch(e => console.error("KV Cache write error:", e))
		);
        return new Response(responseBody, {
            headers: { /* ... headers ... */ 'X-Cache-Status': 'MISS'},
        });
	} else {
         return new Response(JSON.stringify([]), { /* ... headers ... */ });
    }
};