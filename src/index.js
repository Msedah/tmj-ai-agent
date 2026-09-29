import { createClient } from "@supabase/supabase-js";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const SYSTEM_PROMPT = `You are TMJ AI Agent, an academic assistant designed specifically for North-West University (NWU) students.

STRICT PURPOSE:
- Answer only academic and education-related questions.
- Give special priority to NWU university modules, study units, assignments, tests, exam preparation and academic research.
- If a request is not academic/educational, politely refuse and state that TMJ AI Agent is limited to academic assistance.
- Retrieved documents are evidence. Prioritise current NWU official material and the student's uploaded module material for module-specific questions.
- Never call a student upload an official NWU source unless its metadata says it is an official NWU source.
- Do not invent module content, lecturer instructions, page numbers, policies or citations.
- If the supplied documents do not answer an NWU-specific question, say that the available NWU material does not establish the answer.
- Give source notes at the end using the provided source labels.
- Explain concepts clearly at university level.

DEVELOPER: TJ Mailula | mailulajosep@gmail.com`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/index-document") return handleDocumentIndex(request, env);
    if (url.pathname === "/api/index-nwu") return handleNwuIndex(request, env);
    return env.ASSETS.fetch(request);
  }
};

async function authenticate(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\\s+/i, "");
  if (!token) return { error: json(401, { error: "Please sign in first." }) };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { error: json(503, { error: "Database service is not configured." }) };
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: "Bearer " + token } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: json(401, { error: "Your session is invalid or expired." }) };
  return { client, user: data.user, token };
}

async function handleChat(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!env.OPENAI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json(503, { error: "AI/database service is not configured." });
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }
  const message = String(body.message || "").trim();
  if (!message || message.length > 8000) return json(400, { error: "Please provide an academic question under 8000 characters." });

  const emb = await embed(message, env);
  if (!emb.ok) return json(emb.status, { error: emb.error });
  const { data: chunks, error: chunkError } = await auth.client.rpc("match_document_chunks", { query_embedding: emb.embedding, match_count: 8 });
  if (chunkError) return json(500, { error: "Knowledge search failed. Check the Supabase vector function." });

  const selected = (chunks || []).filter(x => Number(x.similarity) >= 0.25);
  const context = selected.map((x, i) => "[Source " + (i + 1) + ": " + x.source_name + (x.module_code ? " | Module " + x.module_code : "") + (x.source_url ? " | " + x.source_url : "") + "]\\n" + x.content).join("\\n\\n");
  const prompt = "RETRIEVED ACADEMIC CONTEXT:\\n" + (context || "No matching uploaded material was found.") + "\\n\\nSTUDENT QUESTION:\\n" + message;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: Number(env.OPENAI_MAX_OUTPUT_TOKENS || 1200),
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) return json(response.status, { error: data.error?.message || "AI provider error" });
  const reply = data.choices?.[0]?.message?.content || "No answer returned.";

  let conversationId = body.conversationId || null;
  if (conversationId) {
    const { data: c } = await auth.client.from("conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!c) conversationId = null;
  }
  if (!conversationId) {
    const title = message.length > 70 ? message.slice(0, 67) + "…" : message;
    const { data: c, error } = await auth.client.from("conversations").insert({ user_id: auth.user.id, title }).select("id").single();
    if (error) return json(500, { error: "Answer generated, but conversation could not be saved." });
    conversationId = c.id;
  }
  const saved = await auth.client.from("messages").insert([
    { conversation_id: conversationId, user_id: auth.user.id, role: "user", content: message },
    { conversation_id: conversationId, user_id: auth.user.id, role: "assistant", content: reply }
  ]);
  if (saved.error) return json(500, { error: "Answer generated, but the conversation could not be saved." });

  return json(200, {
    reply,
    conversationId,
    sources: selected.slice(0, 5).map(x => ({ name: x.source_name, module: x.module_code, type: x.source_type, url: x.source_url }))
  });
}

async function handleDocumentIndex(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!env.OPENAI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: "Indexing service is not configured." });
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }

  const path = String(body.storagePath || "");
  const fileName = String(body.fileName || "");
  const moduleCode = String(body.moduleCode || "").trim().toUpperCase();
  if (!path || !fileName || !path.startsWith(auth.user.id + "/")) return json(400, { error: "Invalid document path." });
  if (!/\\.(pdf|docx|txt|md)$/i.test(fileName)) return json(400, { error: "Supported files are PDF, DOCX, TXT and MD." });

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const download = await admin.storage.from("tmj-documents").download(path);
  if (download.error) return json(404, { error: "Uploaded document could not be read." });

  const buffer = Buffer.from(await download.data.arrayBuffer());
  let text = "";
  try {
    if (/\\.pdf$/i.test(fileName)) text = (await pdfParse(buffer)).text;
    else if (/\\.docx$/i.test(fileName)) text = (await mammoth.extractRawText({ buffer })).value;
    else text = new TextDecoder().decode(buffer);
  } catch {
    return json(422, { error: "The document could not be extracted. Try a text-based PDF or DOCX." });
  }
  text = text.replace(/\\s+/g, " ").trim();
  if (text.length < 30) return json(422, { error: "No usable text was found in the document." });

  const chunks = chunkText(text, 1800, 250);
  if (chunks.length > 250) return json(413, { error: "Document is too large for one indexing operation. Split it into smaller files." });

  const { data: doc, error: docError } = await admin.from("documents").insert({
    user_id: auth.user.id, file_name: fileName, storage_path: path, module_code: moduleCode || null, source_type: "student_upload"
  }).select("id").single();
  if (docError) return json(500, { error: "Could not register the document: " + docError.message });

  const rows = [];
  for (let i = 0; i < chunks.length; i += 20) {
    const batch = chunks.slice(i, i + 20);
    const embeddings = [];
    for (const chunk of batch) {
      const e = await embed(chunk, env);
      if (!e.ok) return json(e.status, { error: e.error });
      embeddings.push(e.embedding);
    }
    batch.forEach((content, j) => rows.push({ document_id: doc.id, user_id: auth.user.id, chunk_index: i + j, content, embedding: embeddings[j] }));
  }
  const { error: chunkError } = await admin.from("document_chunks").insert(rows);
  if (chunkError) return json(500, { error: "Could not save document embeddings: " + chunkError.message });
  return json(200, { ok: true, message: "Document indexed successfully. TMJ AI can now use it for your academic questions.", chunks: chunks.length });
}

async function handleNwuIndex(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!env.NWU_INGEST_SECRET) return json(503, { error: "NWU ingest secret is not configured." });
  if (request.headers.get("x-tmj-ingest-secret") !== env.NWU_INGEST_SECRET) return json(401, { error: "Unauthorized" });
  if (!env.OPENAI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: "Ingestion service is not configured." });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }
  const url = String(body.url || "").trim();
  const moduleCode = String(body.moduleCode || "").trim().toUpperCase();
  try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); } catch { return json(400, { error: "Provide a valid public http(s) URL." }); }

  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "TMJ-AI-NWU-KnowledgeBot/1.0" } });
  if (!response.ok) return json(response.status, { error: "Could not fetch the NWU page." });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("text/plain")) return json(415, { error: "Only public HTML or text pages can be ingested." });

  let text = await response.text();
  if (type.includes("text/html")) text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  text = text.replace(/\\s+/g, " ").trim();
  if (text.length < 100) return json(422, { error: "The page did not contain enough readable text." });

  const chunks = chunkText(text, 1800, 250);
  if (chunks.length > 300) return json(413, { error: "Source is too large; ingest a more specific page." });

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const storagePath = "nwu-official:" + url;
  await admin.from("documents").delete().eq("storage_path", storagePath);
  const parsedUrl = new URL(url);
  const { data: doc, error: docError } = await admin.from("documents").insert({
    user_id: null, file_name: parsedUrl.hostname + " — " + parsedUrl.pathname.slice(0, 80),
    storage_path: storagePath, module_code: moduleCode || null, source_type: "nwu_official", source_url: url
  }).select("id").single();
  if (docError) return json(500, { error: docError.message });

  for (let i = 0; i < chunks.length; i += 20) {
    const batch = chunks.slice(i, i + 20);
    const embeddings = [];
    for (const chunk of batch) {
      const e = await embed(chunk, env);
      if (!e.ok) return json(e.status, { error: e.error });
      embeddings.push(e.embedding);
    }
    const rows = batch.map((content, j) => ({ document_id: doc.id, user_id: null, chunk_index: i + j, content, embedding: embeddings[j] }));
    const { error } = await admin.from("document_chunks").insert(rows);
    if (error) return json(500, { error: error.message });
  }
  return json(200, { ok: true, message: "NWU source indexed successfully.", url, chunks: chunks.length });
}

async function embed(input, env) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.OPENAI_API_KEY },
    body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small", input })
  });
  const d = await r.json();
  if (!r.ok) return { ok: false, status: r.status, error: d.error?.message || "Embedding failed" };
  return { ok: true, embedding: d.data[0].embedding };
}

function chunkText(text, size, overlap) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    out.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return out;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
