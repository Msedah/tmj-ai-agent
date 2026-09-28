const {createClient}=require("@supabase/supabase-js");

exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
 if(!process.env.NWU_INGEST_SECRET)return json(503,{error:"NWU ingest secret is not configured."});
 if(event.headers["x-tmj-ingest-secret"]!==process.env.NWU_INGEST_SECRET)return json(401,{error:"Unauthorized"});
 if(!process.env.OPENAI_API_KEY||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return json(503,{error:"Ingestion service is not configured."});
 let body;try{body=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Invalid JSON"})}
 const url=String(body.url||"").trim();const moduleCode=String(body.moduleCode||"").trim().toUpperCase();
 if(!/^https?:\\/\\//i.test(url))return json(400,{error:"Provide a public http(s) URL."});
 const response=await fetch(url,{redirect:"follow",headers:{"User-Agent":"TMJ-AI-NWU-KnowledgeBot/1.0"}});
 if(!response.ok)return json(response.status,{error:"Could not fetch the NWU page."});
 const type=response.headers.get("content-type")||"";
 if(!type.includes("text/html")&&!type.includes("text/plain"))return json(415,{error:"Only public HTML or text pages can be ingested by this endpoint."});
 let raw=await response.text();let text=raw;
 if(type.includes("text/html"))text=raw.replace(/<script[\\s\\S]*?<\\/script>/gi," ").replace(/<style[\\s\\S]*?<\\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
 text=text.replace(/\s+/g," ").trim();if(text.length<100)return json(422,{error:"The page did not contain enough readable text."});
 const chunks=chunkText(text,1800,250);if(chunks.length>300)return json(413,{error:"Source is too large; split the source or ingest a specific page."});
 const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
 const storagePath="nwu-official:"+url;
 await admin.from("documents").delete().eq("storage_path",storagePath);
 const {data:doc,error:docError}=await admin.from("documents").insert({user_id:null,file_name:new URL(url).hostname+" — "+new URL(url).pathname.slice(0,80),storage_path:storagePath,module_code:moduleCode||null,source_type:"nwu_official",source_url:url}).select("id").single();
 if(docError)return json(500,{error:docError.message});
 for(let i=0;i<chunks.length;i+=20){const batch=chunks.slice(i,i+20);const embeddings=[];for(const chunk of batch){const e=await embed(chunk);if(!e.ok)return json(e.status,{error:e.error});embeddings.push(e.embedding)}const rows=batch.map((content,j)=>({document_id:doc.id,user_id:null,chunk_index:i+j,content,embedding:embeddings[j]}));const {error}=await admin.from("document_chunks").insert(rows);if(error)return json(500,{error:error.message})}
 return json(200,{ok:true,message:"NWU source indexed successfully.",url,chunks:chunks.length});
};
function chunkText(text,size,overlap){const out=[];let start=0;while(start<text.length){const end=Math.min(text.length,start+size);out.push(text.slice(start,end));if(end===text.length)break;start=end-overlap}return out}
async function embed(input){const r=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",input})});const d=await r.json();if(!r.ok)return{ok:false,status:r.status,error:d.error?.message||"Embedding failed"};return{ok:true,embedding:d.data[0].embedding}}
function json(status,body){return{statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)}}