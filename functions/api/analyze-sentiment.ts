// functions/api/analyze-sentiment.ts
/// <reference types="@cloudflare/workers-types" />
import type { Ai} from '@cloudflare/workers-types';

// Workers AI テキスト分類モデルの入力型
interface AiTextClassificationInput {
    text: string;
}

// Workers AI テキスト分類モデルの出力アイテムの型 (モデルにより異なる可能性あり)
interface AiTextClassificationOutputItem {
    label: string; // 例: "POSITIVE", "NEGATIVE", "LABEL_0", "LABEL_1"
    score: number; // 信頼度スコア (0-1)
}

// この Pages Function が期待するリクエストボディの型
interface AnalyzeSentimentRequestBody {
    texts: string[];
}

// この Pages Function が返すレスポンスボディの型
interface AnalyzeSentimentResponseBody {
    sentimentResults: ({
        originalTextIndex: number; // 元のテキスト配列のインデックス
        label: string;
        score: number;
    } | null)[]; // エラーや分析対象外の場合は null
}

// この Pages Function の環境変数・バインディングの型
interface Env {
    AI: Ai; // Cloudflare ダッシュボードで設定した AI バインディング
    // 他に必要なバインディングがあればここに追加 (例: KVNamespace など)
}

// --- ヘルパー関数 ---
const stripHtml = (html: string): string => {
    if (!html) return '';
    let text = html.replace(/<p>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    return text.replace(/\s+/g, ' ').trim();
};

// --- Pages Function ハンドラ (POST リクエストを処理) ---
// 型パラメータ <Env> で環境変数の型を指定
export const onRequestPost: PagesFunction<Env> = async (context) => {
    const { request, env, waitUntil } = context; // context から request, env, waitUntil を取得

    // AI バインディングの存在確認
    if (!env.AI) {
        console.error("AI binding not found in 'analyze-sentiment' function environment.");
        return Response.json({ error: "AI service not configured" }, {
            status: 500,
            // Content-Type は Response.json が自動で設定するが、明示も可能
            // headers: { 'Content-Type': 'application/json' }
          });
    }

    try {
        // リクエストボディを JSON としてパース
        const requestBody = await request.json<AnalyzeSentimentRequestBody>();
        const { texts } = requestBody;

        // 入力テキスト配列のバリデーション
        if (!Array.isArray(texts) || texts.length === 0) {
            return Response.json({ error: "Invalid input: 'texts' array is required and cannot be empty" }, {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        if (texts.length > 50) { // 例: 一度に処理するテキスト数の上限を設定
            return Response.json({ error: "Too many texts to analyze. Limit is 50." }, {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }


        // 使用する AI モデル (Cloudflare ダッシュボードでバインドしたものと合わせるか、ここで指定)
        const modelName = "@cf/huggingface/distilbert-sst-2-int8";

        // 各テキストに対して並行して感情分析を実行
        const analysisPromises = texts.map(async (rawText, index) => {
            const textToAnalyze = stripHtml(rawText);

            // 短すぎる、または長すぎるテキストは分析対象外とする (モデルの推奨に従う)
            if (textToAnalyze.length < 10 || textToAnalyze.length > 512) { // 512 は DistilBERT の一般的な最大トークン長に近い
                console.log(`Skipping analysis for text at index ${index} due to length: ${textToAnalyze.length}`);
                return null;
            }

            try {
                const inputs: AiTextClassificationInput = { text: textToAnalyze };
                // env.AI.run を使ってモデルを実行
                // Workers AI の run メソッドの戻り値はモデルによって異なるため、
                // AiTextClassificationOutputItem[] とアサーションするか、より安全なパース処理を行う
                const aiResponse = await env.AI.run(modelName, inputs) as AiTextClassificationOutputItem[] | null;

                if (aiResponse && Array.isArray(aiResponse) && aiResponse.length > 0) {
                    // 最もスコアの高いラベルを選択
                    const topResult = aiResponse.reduce((prev, current) => (prev.score > current.score) ? prev : current);
                    return {
                        originalTextIndex: index, // 元の配列でのインデックスを保持
                        label: topResult.label,
                        score: topResult.score
                    };
                } else {
                    console.warn(`No valid AI response for text at index ${index}:`, aiResponse);
                    return null;
                }
            } catch (aiError) {
                console.error(`AI analysis error for text at index ${index} ("${textToAnalyze.substring(0, 30)}..."):`, aiError);
                return null; // エラー時も null を返す
            }
        });

        // 全ての分析 Promise の完了を待つ
        const results = await Promise.all(analysisPromises);

        console.log(`Sentiment analysis batch complete. Processed ${results.length} texts.`);

        // レスポンスボディを作成
        const responseBody: AnalyzeSentimentResponseBody = { sentimentResults: results };

        return Response.json(responseBody);

    } catch (error) {
        console.error("Error in 'analyze-sentiment' function:", error);
        let errorMessage = "Failed to analyze sentiment";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        // JSON パースエラーなども考慮
        if (error instanceof SyntaxError) {
            errorMessage = "Invalid JSON in request body";
            return new Response(JSON.stringify({ error: errorMessage }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return Response.json({ error: errorMessage }, { status: 500 });
    }
};