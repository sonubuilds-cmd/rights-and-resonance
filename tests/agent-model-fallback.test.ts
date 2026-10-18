import { test, expect } from 'vitest';
import { createGeminiGenerate } from '../apps/api/src/agent-chat.js';
test('404 falls back to flash alias once', async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => { urls.push(url); return url.includes('gemini-2.5-flash') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] }), { status: 200 }); }) as typeof fetch;
  const gen = createGeminiGenerate('k', { fetchImpl });
  const req = { model: 'gemini-2.5-flash', systemInstruction: 's', contents: [], functionDeclarations: [] } as never;
  expect((await gen(req)).content?.parts?.[0]).toEqual({ text: 'hi' });
  await gen(req);
  expect(urls.map(u => u.split('/models/')[1])).toEqual(['gemini-2.5-flash:generateContent', 'gemini-flash-latest:generateContent', 'gemini-flash-latest:generateContent']);
});
