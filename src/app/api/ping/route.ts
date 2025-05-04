// src/app/api/ping/route.ts の修正
import { NextResponse } from 'next/server';

// request 引数名の前に _ を付ける
export async function GET(_request: Request) {
  console.log("Ping API Route called!");
  return NextResponse.json({ message: 'pong from API Route' });
}