import type { EventContext } from "@cloudflare/workers-types";

// Define the KV Namespace binding type
interface Env {
	TIMELINE_CACHE: KVNamespace;
	// DEEPL related env vars removed
	regions: Record<string, string>; // Assuming this binding works from wrangler.toml [vars]
}

// Define the structure of a Mastodon status (simplified, no translation field)
interface MastodonStatus {
	id: string;
	created_at: string;
	content: string; // HTML content
	url: string;
	account: {
		acct: string; // username@domain
	};
	instance_domain?: string; // Manually add the instance domain
}

// Helper function to sanitize HTML (basic example)
const sanitizeHtml = (html: string): string => {
    let text = html.replace(/<p>/gi, '').replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    return text.replace(/\s+/g, ' ').trim();
};

// onRequestGet Function
export const onRequestGet: PagesFunction<Env> = async (context) => {
	const { request, env, params, waitUntil } = context;
	const region = (params.region as string)?.toUpperCase();
	const cacheKey = `timeline:${region}:notranslation`; // Modify cache key slightly

	// Access regions from wrangler.toml [vars.regions] (Needs verification if this binding works in Pages)
	const regionConfig = env.regions;
	if (!regionConfig) {
		 console.error("Region config not found in environment.");
		 return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
	const instancesString = regionConfig[region];


	// 1. Check KV Cache first
	try {
		const cachedData = await env.TIMELINE_CACHE.get(cacheKey);
		if (cachedData) {
			console.log(`Cache hit for ${region}`);
			return new Response(cachedData, {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=60',
					'X-Cache-Status': 'HIT'
				},
			});
		}
		console.log(`Cache miss for ${region}`);
	} catch (e) {
		console.error("KV Cache read error:", e);
	}

    // 2. Get instances for the region
	if (!instancesString) {
		return new Response(JSON.stringify({ error: 'Invalid or unknown region' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}
	const instanceDomains = instancesString.split(',').map(domain => domain.trim()).filter(Boolean);

	if (instanceDomains.length === 0) {
		return new Response(JSON.stringify({ error: 'No instances configured for this region' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 3. Fetch public timelines from instances concurrently
	const fetchPromises = instanceDomains.map(async (domain) => {
		const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`;
		try {
			const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
			if (!response.ok) {
				console.error(`Failed to fetch from ${domain}: ${response.status}`);
				return [];
			}
			const statuses = await response.json() as MastodonStatus[];
			return statuses.map(status => ({ ...status, instance_domain: domain }));
		} catch (error) {
			console.error(`Error fetching from ${domain}:`, error);
			return [];
		}
	});

	// 4. Combine and sort results
	let combinedStatuses: MastodonStatus[] = [];
	try {
		const results = await Promise.all(fetchPromises);
		combinedStatuses = results.flat();
		combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        combinedStatuses = combinedStatuses.slice(0, 50); // Limit total results
	} catch (error) {
		console.error('Error processing fetch results:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch timelines' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}

    // 5. Translation step removed

	// 6. Store result in KV Cache
	if (combinedStatuses.length > 0) {
         const responseBody = JSON.stringify(combinedStatuses);
		waitUntil(
			env.TIMELINE_CACHE.put(cacheKey, responseBody, { expirationTtl: 300 }) // Cache for 5 minutes
				.catch(e => console.error("KV Cache write error:", e))
		);
        // Return fresh response
        return new Response(responseBody, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60',
                'X-Cache-Status': 'MISS'
            },
        });
	} else {
        // Return empty array if no statuses found
         return new Response(JSON.stringify([]), {
             headers: { 'Content-Type': 'application/json' },
         });
    }
};