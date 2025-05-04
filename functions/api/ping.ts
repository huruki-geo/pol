// functions/api/ping.ts
export const onRequestGet = async () => {
  return new Response(JSON.stringify({ message: "pong" }), {
    headers: { 'Content-Type': 'application/json' }
  });
};