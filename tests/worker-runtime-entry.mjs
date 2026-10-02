import { extractDocumentText } from "../src/index.js";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname !== "/parse" || request.method !== "POST") return new Response("Not found", { status: 404 });
    const fileName = url.searchParams.get("name") || "sample.txt";
    try {
      const text = await extractDocumentText(fileName, Buffer.from(await request.arrayBuffer()));
      return Response.json({ ok: true, text });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error) }, { status: 422 });
    }
  }
};
