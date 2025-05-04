import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { cache } from 'hono/cache';

// Define the KV Namespace binding type (optional but recommended)
interface Env {
	TIMELINE_CACHE: KVNamespace;
	DEEPL_AUTH_KEY: string;
	DEEPL_API_URL?: string; // Optional: Defaults to free API if not set
	regions: Record<string, string>; // Type for region vars from wrangler.toml
}

// Define the structure of a Mastodon status (simplified)
interface MastodonStatus {
	id: string;
	created_at: string;
	content: string; // HTML content
	url: string;
	account: {
		acct: string; // username@domain
	};
	instance_domain?: string; // Manually add the instance domain later
	translated_content?: string; // Field for translated text
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware to allow requests from your frontend domain
app.use('/api/*', cors({
	origin: ['http://localhost:3000', 'YOUR_PRODUCTION_FRONTEND_URL'], // Add your frontend URLs
	allowMethods: ['GET'],
}));

// Cache middleware for the API endpoint
const cacheMiddleware = cache({
	cacheName: 'mastodon-timeline-cache',
	cacheControl: 'max-age=300', // Cache for 5 minutes (300 seconds)
});

// --- Helper Functions ---

// Sanitize HTML content (very basic example, consider a more robust library)
const sanitizeHtml = (html: string): string => {
	// Remove HTML tags
	let text = html.replace(/<[^>]*>/g, ' ');
	// Decode HTML entities
	text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
	// Trim extra whitespace
	return text.replace(/\s+/g, ' ').trim();
};

// Translate text using DeepL API
const translateText = async (text: string, targetLang: string, env: Env): Promise<string | null> => {
	if (!text || !env.DEEPL_AUTH_KEY) {
		return null;
	}
	const apiUrl = env.DEEPL_API_URL || "https://api-free.deepl.com/v2/translate"; // Default to free API

	try {
		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Authorization': `DeepL-Auth-Key ${env.DEEPL_AUTH_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				text: [text],
				target_lang: targetLang,
			}),
		});
		if (!response.ok) {
			console.error(`DeepL API Error: ${response.status} ${response.statusText}`, await response.text());
			return null; // Return null on error
		}
		const data = await response.json() as { translations: { text: string }[] };
		return data.translations[0]?.text || null;
	} catch (error) {
		console.error('Error calling DeepL API:', error);
		return null;
	}
};


// --- API Endpoint ---

app.get('/api/timeline/:region', cacheMiddleware, async (c) => {
	const region = c.req.param('region').toUpperCase();
	const env = c.env;
	const cacheKey = `timeline:${region}`;

	// 1. Check KV Cache first
	try {
		const cachedData = await env.TIMELINE_CACHE.get(cacheKey);
		if (cachedData) {
			console.log(`Cache hit for ${region}`);
			const parsedData: MastodonStatus[] = JSON.parse(cachedData);
			// Add CORS header manually for cached responses if needed
			// c.res.headers.set('Access-Control-Allow-Origin', '*'); // Or specific origin
			return c.json(parsedData);
		}
		console.log(`Cache miss for ${region}`);
	} catch (e) {
		console.error("KV Cache read error:", e);
	}

	// 2. Get instances for the region from wrangler.toml vars
	// const regionConfig = env.regions ? JSON.parse(env.regions) as Record<string, string> : {};
	// const instancesString = regionConfig[region];
    // Alternative: directly access from vars if defined as simple key-value
    const instancesString = env.regions[region];


	if (!instancesString) {
		return c.json({ error: 'Invalid or unknown region' }, 400);
	}
	const instanceDomains = instancesString.split(',').map(domain => domain.trim()).filter(Boolean);

	if (instanceDomains.length === 0) {
		return c.json({ error: 'No instances configured for this region' }, 400);
	}

	// 3. Fetch public timelines from instances concurrently
	const fetchPromises = instanceDomains.map(async (domain) => {
		const url = `https://${domain}/api/v1/timelines/public?limit=20&local=true`; // Get local posts, limit 20
		try {
			const response = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                // Optional: Add timeout for requests using AbortController
            });
			if (!response.ok) {
				console.error(`Failed to fetch from ${domain}: ${response.status}`);
				return []; // Return empty array on failure for this instance
			}
			const statuses = await response.json() as MastodonStatus[];
			// Add instance domain info to each status
			return statuses.map(status => ({ ...status, instance_domain: domain }));
		} catch (error) {
			console.error(`Error fetching from ${domain}:`, error);
			return []; // Return empty array on error
		}
	});

	// 4. Combine and sort results
	let combinedStatuses: MastodonStatus[] = [];
	try {
		const results = await Promise.all(fetchPromises);
		combinedStatuses = results.flat(); // Flatten the array of arrays
		// Sort by creation date, newest first
		combinedStatuses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        // Limit total results if needed (e.g., top 50)
        combinedStatuses = combinedStatuses.slice(0, 50);
	} catch (error) {
		console.error('Error processing fetch results:', error);
        return c.json({ error: 'Failed to fetch timelines' }, 500);
	}


	// 5. Translate content (translate only a limited number for performance/cost)
	const translationPromises = combinedStatuses.slice(0, 20).map(async (status) => { // Translate top 20
		const sanitizedContent = sanitizeHtml(status.content);
		if (sanitizedContent) {
			const translated = await translateText(sanitizedContent, 'JA', env); // Translate to Japanese
			status.translated_content = translated ?? undefined; // Add if translation successful
		}
		return status;
	});

    // Update the combined list with translated content
    try {
        const translatedStatuses = await Promise.all(translationPromises);
        // Need to merge back translated content into combinedStatuses carefully
        // This simple approach assumes order is maintained, which it should be with slice/map/Promise.all
        translatedStatuses.forEach((translatedStatus, index) => {
            if (combinedStatuses[index]?.id === translatedStatus.id) {
                combinedStatuses[index].translated_content = translatedStatus.translated_content;
            }
        });
    } catch (error) {
        console.error('Error during translation:', error);
        // Proceed without translations if error occurs
    }


	// 6. Store result in KV Cache (don't wait for this to finish)
	if (combinedStatuses.length > 0) {
		c.executionCtx.waitUntil(
			env.TIMELINE_CACHE.put(cacheKey, JSON.stringify(combinedStatuses), { expirationTtl: 300 }) // Cache for 5 minutes
				.catch(e => console.error("KV Cache write error:", e))
		);
	}

	// 7. Return combined & translated data
	return c.json(combinedStatuses);
});

export default app;