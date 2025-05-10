// functions/api/analyze-sentiment.ts
// (型定義は必要に応じて route.ts から持ってくるか共通化する)
interface Ai { run: (model: string, inputs: any) => Promise<any>; }
interface Env { AI: Ai; }
interface AiTextClassificationInput { text: string; }
interface AiTextClassificationOutput { label: string; score: number; }

const stripHtml = (html: string): string => {
    if (!html) return ''; // html が空なら空文字列を返す

    let text = html.replace(/<p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    // ★★★ 処理結果を return する ★★★
    return text.replace(/\s+/g, ' ').trim();
};

// Pages Function のシグネチャ
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { request, env } = context;

    // AI Binding があるか確認
    if (!env.AI) {
        console.error("AI binding not found in analyze-sentiment function env.");
        return new Response(JSON.stringify({ error: "AI service not configured" }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        // リクエストボディからテキストの配列を取得 (例: { texts: ["text1", "text2"] })
        const { texts } = await request.json<{ texts: string[] }>();
        if (!Array.isArray(texts) || texts.length === 0) {
            return new Response(JSON.stringify({ error: "Invalid input: texts array is required" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const model = '@cf/huggingface/distilbert-sst-2-int8';
        const sentimentResults: ({ originalText: string; label: string; score: number } | null)[] = [];

        const analysisPromises = texts.map(async (rawText) => {
            const textToAnalyze = stripHtml(rawText);
            if (textToAnalyze.length < 10 || textToAnalyze.length > 500) { return null; }
            try {
                const inputs: AiTextClassificationInput = { text: textToAnalyze };
                const result: AiTextClassificationOutput[] = await env.AI.run(model, inputs);
                if (result && result.length > 0) {
                    const topResult = result.reduce((prev, current) => (prev.score > current.score) ? prev : current);
                    return { originalText: rawText, label: topResult.label, score: topResult.score };
                }
            } catch (aiError) {
                console.error(`AI analysis error for text: "${textToAnalyze.substring(0, 20)}..."`, aiError);
            }
            return null;
        });

        const results = await Promise.all(analysisPromises);
        console.log("Sentiment analysis batch complete. Results count:", results.filter(r => r !== null).length);

        return new Response(JSON.stringify({ sentimentResults: results }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Error in analyze-sentiment function:", error);
        return new Response(JSON.stringify({ error: "Failed to analyze sentiment" }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
};