// src/app/api/ping/route.ts の修正
import { NextResponse } from 'next/server';

// request 引数を削除
export async function GET() {
  console.log("Ping API Route called!");
  return NextResponse.json({ message: 'pong from API Route' });
}