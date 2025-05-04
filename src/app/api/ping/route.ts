// src/app/api/ping/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  console.log("Ping API Route called!"); // ログ出力テスト
  return NextResponse.json({ message: 'pong from API Route' });
}